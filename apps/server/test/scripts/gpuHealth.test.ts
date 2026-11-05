import { describe, expect, it } from 'vitest';
import {
  buildQueryScript,
  evaluate,
  filterNewer,
  MAX_TEMP_C,
  parseArgs,
  parseEvents,
  parseNvidiaSmi,
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
    const events = parseEvents(JSON.stringify([wer('WATCHDOG-20260903-0140.dmp'), wer('WATCHDOG-20261105-1820.dmp'), wer('no-stamp.dmp')]));
    const kept = filterNewer(events, new Date(2026, 10, 5, 18, 0).getTime());
    expect(kept.map((e) => e.message.match(/[\w-]+\.dmp/)?.[0])).toEqual(['WATCHDOG-20261105-1820.dmp', 'no-stamp.dmp']);
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

  it('is healthy without events and below the temperature limit', () => {
    expect(evaluate({ events: [], gpu: cool, errors: [] })).toEqual({ ok: true, reasons: [] });
    expect(evaluate({ events: [], gpu: { tempC: MAX_TEMP_C }, errors: [] }).ok).toBe(true);
  });

  it('fails on any new nvlddmkm event', () => {
    const result = evaluate({ events: parseEvents(JSON.stringify([FECS, GPUID])), gpu: cool, errors: [] });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain('2 new GPU driver');
  });

  it('fails above 83 C', () => {
    const result = evaluate({ events: [], gpu: { tempC: 84 }, errors: [] });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain('84 C');
  });

  it('fails closed when a source could not be read', () => {
    const result = evaluate({ events: [], gpu: null, errors: ['nvidia-smi: nvidia-smi failed'] });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain('could not check');
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
