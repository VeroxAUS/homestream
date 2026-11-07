import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildQueryScript,
  DEFAULT_MIN_FREE_GB,
  evaluate,
  filterNewer,
  MAX_TEMP_C,
  parseArgs,
  parseEvents,
  IDLE_SAMPLE_GAP_MS,
  IDLE_SAMPLES,
  MAX_IDLE_UTIL_PCT,
  parseGpuProcessNames,
  parseNvidiaSmi,
  parseSystemInfo,
  readMemory,
  summarizeIdle,
  SYSTEM_INFO_SCRIPT,
} from '../../../../scripts/gpu-health.mjs';

const FECS = {
  time: '2026-11-05T04:21:07.1234567Z',
  log: 'System',
  provider: 'nvlddmkm',
  id: 13,
  level: 'Error',
  message: 'Graphics FECS Exception:\r\nLogging error 0x2\r\n',
};
const GPUID = { ...FECS, time: '2026-11-05T04:21:08.0000000Z', id: 153, message: 'Error occurred on GPUID: 100' };

describe('parseArgs', () => {
  it('normalises --since to an ISO instant', () => {
    const parsed = parseArgs(['--since', '2026-11-05T18:30:00+10:00']);
    expect(parsed.since).toBe('2026-11-05T08:30:00.000Z');
    expect(parsed.sinceMs).toBe(Date.parse('2026-11-05T08:30:00Z'));
  });

  it('defaults the free RAM minimum to 4 GB and reads --min-free-gb', () => {
    expect(DEFAULT_MIN_FREE_GB).toBe(4);
    expect(parseArgs(['--since', '2026-11-05T08:30:00Z']).minFreeGb).toBe(4);
    expect(parseArgs(['--since', '2026-11-05T08:30:00Z', '--min-free-gb', '6.5']).minFreeGb).toBe(6.5);
    expect(parseArgs(['--min-free-gb', '2', '--since', '2026-11-05T08:30:00Z']).minFreeGb).toBe(2);
  });

  it('rejects a missing, negative or non-numeric --min-free-gb', () => {
    const since = ['--since', '2026-11-05T08:30:00Z'];
    expect(() => parseArgs([...since, '--min-free-gb'])).toThrow(/min-free-gb/);
    expect(() => parseArgs([...since, '--min-free-gb', 'lots'])).toThrow(/min-free-gb/);
    expect(() => parseArgs([...since, '--min-free-gb', '-1'])).toThrow(/min-free-gb/);
  });

  it('rejects a missing or invalid --since', () => {
    expect(() => parseArgs([])).toThrow(/--since/);
    expect(() => parseArgs(['--since'])).toThrow(/--since/);
    expect(() => parseArgs(['--since', 'yesterday-ish'])).toThrow(/valid date/);
  });
});

describe('parseEvents', () => {
  it('returns [] for empty output', () => {
    expect(parseEvents('')).toEqual([]);
    expect(parseEvents('  \r\n')).toEqual([]);
    expect(parseEvents('[]')).toEqual([]);
  });

  it('accepts a single object as well as an array and sorts by time', () => {
    expect(parseEvents(JSON.stringify(FECS))).toHaveLength(1);
    const parsed = parseEvents(JSON.stringify([GPUID, FECS]));
    expect(parsed.map((e) => e.id)).toEqual([13, 153]);
  });

  it('collapses multi-line messages onto one line and keeps the provider and id', () => {
    const [event] = parseEvents(JSON.stringify(FECS));
    expect(event).toMatchObject({ provider: 'nvlddmkm', id: 13, level: 'Error' });
    expect(event?.message).toBe('Graphics FECS Exception: Logging error 0x2');
  });

  it('throws on non-JSON output so a broken query cannot pass as "no events"', () => {
    expect(() => parseEvents('Get-WinEvent : something went wrong')).toThrow();
  });
});

describe('filterNewer', () => {
  it('keeps only events after the start time', () => {
    const events = parseEvents(JSON.stringify([FECS, GPUID]));
    expect(filterNewer(events, Date.parse('2026-11-05T04:21:07.5Z')).map((e) => e.id)).toEqual([153]);
    expect(filterNewer(events, Date.parse('2026-11-05T05:00:00Z'))).toEqual([]);
  });

  it('ignores late WER reports about LiveKernelEvents that happened before the start time', () => {
    const wer = (dump: string) => ({
      time: new Date(2026, 10, 5, 19, 0).toISOString(),
      log: 'Application',
      provider: 'Windows Error Reporting',
      id: 1001,
      level: 'Information',
      message: `Event Name: LiveKernelEvent P1: 141 Attached files: \\\\?\\C:\\WINDOWS\\LiveKernelReports\\WATCHDOG\\${dump}`,
    });
    const events = parseEvents(
      JSON.stringify([wer('WATCHDOG-20260903-0140.dmp'), wer('WATCHDOG-20261105-1820.dmp'), wer('no-stamp.dmp')]),
    );
    const kept = filterNewer(events, new Date(2026, 10, 5, 18, 0).getTime());
    expect(kept.map((e) => e.message.match(/[\w-]+\.dmp/)?.[0])).toEqual([
      'WATCHDOG-20261105-1820.dmp',
      'no-stamp.dmp',
    ]);
  });
});

describe('parseNvidiaSmi', () => {
  it('parses csv values that carry units', () => {
    expect(parseNvidiaSmi('55, 27 %, 3 %, 0 %, 2341 MiB, 45.34 W\r\n')).toEqual({
      tempC: 55,
      utilGpuPct: 27,
      utilEncoderPct: 3,
      utilDecoderPct: 0,
      memUsedMiB: 2341,
      powerW: 45.34,
    });
  });

  it('maps [N/A] to null and uses the hottest GPU for the temperature', () => {
    const parsed = parseNvidiaSmi('60, 10 %, [N/A], 0 %, 100 MiB, [N/A]\n71, 0 %, 0 %, 0 %, 50 MiB, 20 W\n');
    expect(parsed.tempC).toBe(71);
    expect(parsed.utilEncoderPct).toBeNull();
    expect(parsed.powerW).toBeNull();
  });

  it('throws on empty or malformed output', () => {
    expect(() => parseNvidiaSmi('')).toThrow(/unexpected nvidia-smi output/);
    expect(() => parseNvidiaSmi('NVIDIA-SMI has failed')).toThrow(/unexpected nvidia-smi output/);
  });
});

describe('evaluate', () => {
  const cool = { tempC: 60 };
  const roomy = { freeGb: 12 };

  it('is healthy without events, below the temperature limit and with enough free RAM', () => {
    expect(evaluate({ events: [], gpu: cool, memory: roomy, errors: [] })).toEqual({ ok: true, reasons: [] });
    expect(evaluate({ events: [], gpu: { tempC: MAX_TEMP_C }, memory: roomy, errors: [] }).ok).toBe(true);
  });

  it('fails with low_memory below the minimum and passes at exactly the minimum', () => {
    const low = evaluate({ events: [], gpu: cool, memory: { freeGb: 3.99 }, errors: [] });
    expect(low.ok).toBe(false);
    expect(low.reasons).toHaveLength(1);
    expect(low.reasons[0]).toMatch(/^low_memory:/);
    expect(evaluate({ events: [], gpu: cool, memory: { freeGb: 4 }, errors: [] }).ok).toBe(true);
  });

  it('honours a custom minimum', () => {
    expect(evaluate({ events: [], gpu: cool, memory: { freeGb: 6 }, minFreeGb: 8, errors: [] }).reasons[0]).toMatch(
      /^low_memory:.*8 GB/,
    );
    expect(evaluate({ events: [], gpu: cool, memory: { freeGb: 6 }, minFreeGb: 5, errors: [] }).ok).toBe(true);
  });

  it('fails closed when free RAM is unknown', () => {
    for (const memory of [null, undefined, { freeGb: Number.NaN }]) {
      const result = evaluate({ events: [], gpu: cool, memory, errors: [] });
      expect(result.ok).toBe(false);
      expect(result.reasons[0]).toContain('could not check');
    }
  });

  it('reports every failing check, not just the first', () => {
    const result = evaluate({
      events: parseEvents(JSON.stringify([FECS])),
      gpu: { tempC: 90 },
      memory: { freeGb: 1 },
      errors: [],
    });
    expect(result.reasons).toHaveLength(3);
  });

  it('fails on any new nvlddmkm event', () => {
    const result = evaluate({
      events: parseEvents(JSON.stringify([FECS, GPUID])),
      gpu: cool,
      memory: roomy,
      errors: [],
    });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain('2 new GPU driver');
  });

  it('fails above 83 C', () => {
    const result = evaluate({ events: [], gpu: { tempC: 84 }, memory: roomy, errors: [] });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain('84 C');
  });

  it('fails closed when a source could not be read', () => {
    const result = evaluate({ events: [], gpu: null, memory: roomy, errors: ['nvidia-smi: nvidia-smi failed'] });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain('could not check');
  });
});

describe('--require-idle', () => {
  const cool = { tempC: 50 };
  const roomy = { freeGb: 12 };
  const idleOf = (utilPct: number | null, ffmpegRunning: boolean | null = false, processes: string[] = []) => ({
    ffmpegRunning,
    utilPct,
    processes,
  });

  it('parses the flag', () => {
    expect(parseArgs(['--since', '2026-11-05T00:00:00Z']).requireIdle).toBe(false);
    expect(parseArgs(['--since', '2026-11-05T00:00:00Z', '--require-idle']).requireIdle).toBe(true);
  });

  it('passes below the limit and fails with gpu_busy at or above it, naming the GPU processes', () => {
    expect(evaluate({ events: [], gpu: cool, memory: roomy, idle: idleOf(24), errors: [] })).toEqual({
      ok: true,
      reasons: [],
    });
    const busy = evaluate({
      events: [],
      gpu: cool,
      memory: roomy,
      idle: idleOf(MAX_IDLE_UTIL_PCT, false, ['Wow.exe', 'explorer.exe']),
      errors: [],
    });
    expect(busy.ok).toBe(false);
    expect(busy.reasons).toHaveLength(1);
    expect(busy.reasons[0]).toMatch(/^gpu_busy: .*25%.*Wow\.exe, explorer\.exe/);
    expect(evaluate({ events: [], gpu: cool, memory: roomy, idle: idleOf(99), errors: [] }).reasons[0]).toMatch(
      /^gpu_busy:/,
    );
  });

  it('ignores utilization while a HomeStream ffmpeg is running', () => {
    expect(evaluate({ events: [], gpu: cool, memory: roomy, idle: idleOf(90, true), errors: [] }).ok).toBe(true);
  });

  it('fails closed when utilization or the ffmpeg list is unknown', () => {
    for (const idle of [idleOf(null), idleOf(5, null)]) {
      const result = evaluate({ events: [], gpu: cool, memory: roomy, idle, errors: [] });
      expect(result.ok).toBe(false);
      expect(result.reasons[0]).toContain('could not check');
    }
  });

  it('does not check idleness unless asked', () => {
    expect(evaluate({ events: [], gpu: cool, memory: roomy, errors: [] }).ok).toBe(true);
  });

  it('summarises samples as their median plus the number of spikes, and reports unknown when any sample is missing', () => {
    expect(summarizeIdle([3, 40, 5, 4, 6])).toMatchObject({ utilPct: 5, spikes: 0 });
    expect(summarizeIdle([90, 100, 95, 97, 99])).toMatchObject({ utilPct: 97, spikes: 5 });
    expect(summarizeIdle([4, 6]).utilPct).toBe(5);
    expect(summarizeIdle([3, null, 5]).utilPct).toBeNull();
    expect(summarizeIdle([3, null, 5]).spikes).toBeNull();
    expect(summarizeIdle([]).utilPct).toBeNull();
  });

  describe('transient spikes versus sustained load', () => {
    const verdict = (samples: Array<number | null>, ffmpegRunning: boolean | null = false) =>
      evaluate({
        events: [],
        gpu: cool,
        memory: roomy,
        idle: { ...summarizeIdle(samples), ffmpegRunning, processes: ['Discord.exe'] },
        errors: [],
      });

    it('samples five times', () => {
      expect(IDLE_SAMPLES).toBe(5);
      expect(IDLE_SAMPLES * IDLE_SAMPLE_GAP_MS).toBeGreaterThanOrEqual(4000);
    });

    it('passes one transient 30-40% sample from a desktop app on an otherwise idle GPU', () => {
      expect(verdict([3, 38, 2, 4, 3])).toEqual({ ok: true, reasons: [] });
      expect(verdict([35, 3, 2, 3, 2]).ok).toBe(true);
      expect(verdict([2, 3, 2, 3, 40]).ok).toBe(true);
    });

    it('passes one or two brief readings below the spike level, and a single spike of any height', () => {
      expect(verdict([40, 3, 35, 2, 3]).ok).toBe(true);
      expect(verdict([3, 2, 100, 3, 2]).ok).toBe(true);
    });

    it('fails when the median reaches the limit', () => {
      for (const samples of [
        [30, 35, 3, 40, 2],
        [25, 25, 25, 1, 1],
        [25, 26, 27, 28, 29],
      ]) {
        const result = verdict(samples);
        expect(result.ok, samples.join(',')).toBe(false);
        expect(result.reasons[0]).toMatch(/^gpu_busy: median GPU utilization \d+(\.\d+)?% .*Discord\.exe/);
      }
      expect(verdict([24, 24, 24, 24, 24]).ok).toBe(true);
    });

    it('fails on two samples at or above 60% even when the median is low', () => {
      const result = verdict([3, 60, 2, 99, 3]);
      expect(result.ok).toBe(false);
      expect(result.reasons[0]).toMatch(/^gpu_busy: 2 GPU samples at or above 60%/);
      expect(verdict([3, 59, 2, 59, 3]).ok).toBe(true);
    });

    it('fails every time for a game at 90-100%', () => {
      for (const samples of [
        [90, 95, 100, 99, 92],
        [100, 100, 100, 100, 100],
        [98, 97, 99, 96, 100],
        [90, 3, 91, 4, 92],
      ]) {
        expect(verdict(samples).ok, samples.join(',')).toBe(false);
      }
    });

    it('stays fail-closed on unknown samples and ignores them only while an ffmpeg runs', () => {
      expect(verdict([3, null, 2, 3, 2]).reasons[0]).toContain('could not check');
      expect(verdict([3, 2, 3, 2, null]).ok).toBe(false);
      expect(verdict([95, 95, 95, 95, 95], true).ok).toBe(true);
      expect(verdict([3, 2, 3, 2, 3], null).reasons[0]).toContain('could not check');
    });
  });

  it('reads process names from the nvidia-smi table', () => {
    const table = [
      '|    0   N/A  N/A           10772    C+G   C:\\Windows\\explorer.exe               N/A      |',
      '|    0   N/A  N/A           17640    C+G   ...cord\\app-1.0.9267\\Discord.exe      N/A      |',
      '|    0   N/A  N/A            4242      C   ...ames\\Wow\\_retail_\\Wow.exe      1234MiB |',
      '|  GPU   GI   CI              PID   Type   Process name                        GPU Memory |',
      '|    0   N/A  N/A           17641    C+G   ...cord\\app-1.0.9267\\Discord.exe      N/A      |',
    ].join('\r\n');
    expect(parseGpuProcessNames(table)).toEqual(['Discord.exe', 'explorer.exe', 'Wow.exe']);
    expect(parseGpuProcessNames('No running processes found')).toEqual([]);
  });
});

describe('readMemory', () => {
  it('converts free bytes to GB with two decimals', () => {
    expect(readMemory(4 * 1024 ** 3).freeGb).toBe(4);
    expect(readMemory(3.5 * 1024 ** 3 + 12_345).freeGb).toBe(3.5);
    expect(readMemory(0).freeGb).toBe(0);
  });
});

describe('parseSystemInfo (info only)', () => {
  it('reads pagefile usage and the D: disk queue length', () => {
    const info = parseSystemInfo(
      JSON.stringify({ pagefile: { name: 'E:\\pagefile.sys', usedMiB: 354, sizeMiB: 18432 }, diskQueueD: 1.5 }),
    );
    expect(info).toEqual({ pagefile: [{ name: 'E:\\pagefile.sys', usedMiB: 354, sizeMiB: 18432 }], diskQueueD: 1.5 });
  });

  it('accepts several pagefiles, a missing queue counter and empty output', () => {
    const info = parseSystemInfo(
      JSON.stringify({
        pagefile: [
          { name: 'a', usedMiB: 1, sizeMiB: 2 },
          { name: 'b', usedMiB: 3, sizeMiB: 4 },
        ],
        diskQueueD: null,
      }),
    );
    expect(info.pagefile).toHaveLength(2);
    expect(info.diskQueueD).toBeNull();
    expect(parseSystemInfo('')).toEqual({ pagefile: [], diskQueueD: null });
  });

  it('reads the pagefile and the PhysicalDisk queue counter', () => {
    expect(SYSTEM_INFO_SCRIPT).toContain('Win32_PageFileUsage');
    expect(SYSTEM_INFO_SCRIPT).toContain('PhysicalDisk(*)');
    expect(SYSTEM_INFO_SCRIPT).toContain('Current Disk Queue Length');
  });
});

describe('buildQueryScript', () => {
  it('queries nvlddmkm, Display and LiveKernelEvent reports from the given instant', () => {
    const script = buildQueryScript(1_788_000_000_123.9);
    expect(script).toContain("ProviderName = 'nvlddmkm'");
    expect(script).toContain("ProviderName = 'Display'");
    expect(script).toContain('LiveKernelEvent');
    expect(script).toContain('FromUnixTimeMilliseconds(1788000000123)');
  });
});

describe('command line entry', () => {
  it('runs main() and fails closed on bad arguments, also when the repo path goes through a junction', () => {
    const script = fileURLToPath(new URL('../../../../scripts/gpu-health.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--since', 'not-a-date'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
  });
});
