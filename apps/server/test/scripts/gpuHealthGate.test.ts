import { describe, expect, it } from 'vitest';
import {
  countFfmpeg,
  ownedRoots,
  parseFfmpegProcesses,
  parsePidRegistry,
  readPidRegistries,
} from '../../../../scripts/gpu-health-ffmpeg.mjs';
import {
  evaluate,
  MAX_IDLE_UTIL_PCT,
  parseNvidiaSmi,
  readIdle,
  readMemory,
  summarizeIdle,
} from '../../../../scripts/gpu-health.mjs';

const GIB = 1024 ** 3;
const SESSION = '3f9c2a10-5b7e-4d21-9a44-0c1d2e3f4a5b';
const HOMESTREAM_LINE = `ffmpeg.exe -hide_banner -loglevel error -y -progress pipe:1 -i http://127.0.0.1:8600/src/a -f hls E:\\HomeStream\\transcode\\${SESSION}\\ffmpeg.m3u8`;
const UNRELATED_LINE =
  'C:\\Tools\\ffmpeg.exe -i C:\\Users\\someone\\Videos\\clip.mkv -c:v libx264 C:\\Users\\someone\\out.mp4';

describe('temperature is a required source (fails closed)', () => {
  const roomy = { freeGb: 12 };
  const smi = (temp: string) => `${temp}, 0 %, 0 %, 0 %, 100 MiB, 20 W\n`;
  const verdict = (stdout: string) => evaluate({ events: [], gpu: parseNvidiaSmi(stdout), memory: roomy, errors: [] });

  it('fails when nvidia-smi answers but reports the temperature as [N/A]', () => {
    const result = verdict(smi('[N/A]'));
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual([expect.stringMatching(/^could not check: .*temperature/)]);
  });

  it('fails for an empty, Not Supported or non-finite temperature', () => {
    for (const temp of ['', 'N/A', 'Not Supported', 'Infinity', 'NaN']) {
      expect(verdict(smi(temp)).ok, temp).toBe(false);
    }
  });

  it('fails when the reading is missing or its temperature is not a finite number', () => {
    for (const gpu of [null, { tempC: null }, { tempC: Number.NaN }, { tempC: Number.POSITIVE_INFINITY }]) {
      const result = evaluate({ events: [], gpu, memory: roomy, errors: [] });
      expect(result.ok).toBe(false);
      expect(result.reasons.join(' ')).toContain('could not check');
    }
  });

  it('fails when any of several GPUs has no temperature, even if another one is cool', () => {
    expect(verdict('60, 0 %, 0 %, 0 %, 100 MiB, 20 W\n[N/A], 0 %, 0 %, 0 %, 50 MiB, 20 W\n').ok).toBe(false);
  });

  it('still passes a readable cool GPU and fails a hot one', () => {
    expect(verdict(smi('45')).ok).toBe(true);
    expect(verdict(smi('83')).ok).toBe(true);
    expect(verdict(smi('84')).ok).toBe(false);
  });
});

describe('free RAM is compared unrounded', () => {
  const cool = { tempC: 50 };

  it('fails 3.996 GiB against the 4 GB minimum although it displays as 4', () => {
    const memory = readMemory(3.996 * GIB);
    expect(memory.freeGb).toBe(4);
    const result = evaluate({ events: [], gpu: cool, memory, errors: [] });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/^low_memory: 3\.996 GB/);
  });

  it('passes exactly the minimum and anything above it', () => {
    expect(evaluate({ events: [], gpu: cool, memory: readMemory(4 * GIB), errors: [] }).ok).toBe(true);
    expect(evaluate({ events: [], gpu: cool, memory: readMemory(4 * GIB + 1), errors: [] }).ok).toBe(true);
  });

  it('compares against a custom minimum the same way', () => {
    const result = evaluate({ events: [], gpu: cool, memory: readMemory(5.999 * GIB), minFreeGb: 6, errors: [] });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/^low_memory: 5\.999 GB.*6 GB/);
  });

  it('keeps accepting a reading that only has the rounded freeGb', () => {
    expect(evaluate({ events: [], gpu: cool, memory: { freeGb: 3.99 }, errors: [] }).ok).toBe(false);
    expect(evaluate({ events: [], gpu: cool, memory: { freeGb: 4 }, errors: [] }).ok).toBe(true);
  });
});

describe('only HomeStream ffmpeg processes exempt the utilization check', () => {
  const registry = [{ pid: 4321, sessionId: SESSION, startedAt: 1 }];
  const gameSamples = summarizeIdle([99, 98, 100, 97, 99]);
  const idleFor = (processes: Array<{ pid: number; commandLine: string | null }>, reg = registry) => {
    const { owned } = countFfmpeg(processes, { registry: reg, roots: ownedRoots({}) });
    return { ...gameSamples, ffmpegRunning: owned > 0, processes: ['Wow.exe'] };
  };
  const verdict = (idle: ReturnType<typeof idleFor>) =>
    evaluate({ events: [], gpu: { tempC: 50 }, memory: { freeGb: 12 }, idle, errors: [] });

  it('parses the process list: none, one object, several, and a process without a readable command line', () => {
    expect(parseFfmpegProcesses('')).toEqual([]);
    expect(parseFfmpegProcesses('  \r\n')).toEqual([]);
    expect(parseFfmpegProcesses(JSON.stringify({ pid: 7, commandLine: 'ffmpeg.exe -i a' }))).toEqual([
      { pid: 7, commandLine: 'ffmpeg.exe -i a' },
    ]);
    expect(
      parseFfmpegProcesses(
        JSON.stringify([
          { pid: 1, commandLine: null },
          { pid: 2, commandLine: '' },
          { pid: 'x', commandLine: 'junk' },
        ]),
      ),
    ).toEqual([
      { pid: 1, commandLine: null },
      { pid: 2, commandLine: null },
    ]);
    expect(() => parseFfmpegProcesses('Get-CimInstance : denied')).toThrow();
  });

  it('keeps the gate on for a game when only an unrelated ffmpeg runs', () => {
    const result = verdict(idleFor([{ pid: 999, commandLine: UNRELATED_LINE }]));
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/^gpu_busy: .*Wow\.exe/);
  });

  it('ignores utilization while a registered HomeStream ffmpeg runs', () => {
    expect(verdict(idleFor([{ pid: 4321, commandLine: HOMESTREAM_LINE }])).ok).toBe(true);
  });

  it('recognises a HomeStream ffmpeg by its command line when the registry cannot be read', () => {
    expect(verdict(idleFor([{ pid: 55, commandLine: HOMESTREAM_LINE }], [])).ok).toBe(true);
    expect(verdict(idleFor([{ pid: 55, commandLine: HOMESTREAM_LINE.replaceAll('\\', '/') }], [])).ok).toBe(true);
  });

  it('does not trust a registry pid that was recycled by an unrelated ffmpeg', () => {
    expect(verdict(idleFor([{ pid: 4321, commandLine: UNRELATED_LINE }])).ok).toBe(false);
  });

  it('does not exempt a process whose command line is unreadable', () => {
    expect(verdict(idleFor([{ pid: 4321, commandLine: null }])).ok).toBe(false);
  });

  it('still counts a mixed list as HomeStream running, and reports how many are foreign', () => {
    const processes = [
      { pid: 999, commandLine: UNRELATED_LINE },
      { pid: 4321, commandLine: HOMESTREAM_LINE },
    ];
    expect(countFfmpeg(processes, { registry, roots: ownedRoots({}) })).toEqual({ owned: 1, foreign: 1 });
    expect(verdict(idleFor(processes)).ok).toBe(true);
  });

  it('uses the configured transcode and test roots and matches the extractor marker from the registry', () => {
    const roots = ownedRoots({ TRANSCODE_DIR: 'F:\\media\\tc', HOMESTREAM_TEST_ROOT: 'F:\\tests' });
    expect(roots.slice(0, 2)).toEqual(['F:\\media\\tc', 'F:\\tests']);
    const custom = { pid: 8, commandLine: 'ffmpeg.exe -i x F:\\Media\\TC\\abc\\ffmpeg.m3u8' };
    expect(countFfmpeg([custom], { roots }).owned).toBe(1);
    const extractor = { pid: 9, commandLine: 'ffmpeg.exe -i x -c:s webvtt out.vtt' };
    const entry = { pid: 9, sessionId: 's', match: 'webvtt' };
    expect(countFfmpeg([extractor], { registry: [entry], roots }).owned).toBe(1);
    expect(countFfmpeg([extractor], { registry: [], roots }).owned).toBe(0);
  });

  it('keeps the busy threshold for an idle check without any ffmpeg', () => {
    const result = verdict({ ...idleFor([]), utilPct: MAX_IDLE_UTIL_PCT });
    expect(result.ok).toBe(false);
  });
});

describe('readIdle wiring (fake commands)', () => {
  const GAME_SAMPLE = '60, 99 %, 0 %, 0 %, 4000 MiB, 200 W\n';
  const TABLE = '|    0   N/A  N/A            4242    C+G   ...ames\\Wow\\_retail_\\Wow.exe      N/A      |\n';

  // The process list resolves on a deferred promise, after the first utilization samples have been requested.
  function fakeCommands(processList: Promise<string>) {
    const calls: string[] = [];
    const run = async (command: string, args: string[]) => {
      calls.push(command);
      if (command === 'powershell.exe') return processList;
      return args.length === 0 ? TABLE : GAME_SAMPLE;
    };
    return { run, calls, wait: async () => undefined };
  }
  const gate = (idle: Awaited<ReturnType<typeof readIdle>>) =>
    evaluate({ events: [], gpu: { tempC: 55 }, memory: { freeGb: 12 }, idle, errors: [] });

  it('keeps the gate on for a game at 99% while only an unrelated ffmpeg runs', async () => {
    let release!: (text: string) => void;
    const deferred = new Promise<string>((resolve) => (release = resolve));
    const fake = fakeCommands(deferred);
    const pending = readIdle({ ...fake, registry: [], roots: ownedRoots({}) });
    release(JSON.stringify([{ pid: 999, commandLine: UNRELATED_LINE }]));
    const idle = await pending;
    expect(idle).toMatchObject({ ffmpegRunning: false, foreignFfmpeg: 1, processes: ['Wow.exe'] });
    const result = gate(idle);
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/^gpu_busy: .*no HomeStream ffmpeg running.*Wow\.exe/);
  });

  it('exempts utilization while a registered HomeStream ffmpeg runs', async () => {
    const fake = fakeCommands(Promise.resolve(JSON.stringify({ pid: 4321, commandLine: HOMESTREAM_LINE })));
    const idle = await readIdle({
      ...fake,
      registry: [{ pid: 4321, sessionId: SESSION }],
      roots: ownedRoots({}),
    });
    expect(idle).toMatchObject({ ffmpegRunning: true, foreignFfmpeg: 0 });
    expect(gate(idle).ok).toBe(true);
  });

  it('treats no ffmpeg as not running, so the game blocks the step', async () => {
    const idle = await readIdle({ ...fakeCommands(Promise.resolve('')), registry: [], roots: ownedRoots({}) });
    expect(idle.ffmpegRunning).toBe(false);
    expect(gate(idle).ok).toBe(false);
  });

  it('fails closed when the process list cannot be read or parsed', async () => {
    const failing = fakeCommands(Promise.reject(new Error('powershell.exe failed')));
    const unreadable = await readIdle({ ...failing, registry: [], roots: ownedRoots({}) });
    expect(unreadable.ffmpegRunning).toBeNull();
    expect(gate(unreadable).reasons[0]).toContain('could not check');
    const garbled = await readIdle({
      ...fakeCommands(Promise.resolve('Get-CimInstance : denied')),
      registry: [],
      roots: [],
    });
    expect(garbled.ffmpegRunning).toBeNull();
    expect(gate(garbled).ok).toBe(false);
  });
});

describe('PID registry reading', () => {
  it('reads valid entries and ignores broken ones', () => {
    const text = JSON.stringify({ pids: [{ pid: 1, sessionId: 'a' }, { pid: 'x', sessionId: 'b' }, null, { pid: 2 }] });
    expect(parsePidRegistry(text)).toEqual([{ pid: 1, sessionId: 'a' }]);
    expect(parsePidRegistry('not json')).toEqual([]);
    expect(parsePidRegistry('{}')).toEqual([]);
  });

  it('collects entries from the configured and default data directories and skips unreadable files', () => {
    const files: Record<string, string> = {
      'G:\\data\\ffmpeg-pids.json': JSON.stringify({ pids: [{ pid: 5, sessionId: 'abc' }] }),
    };
    const read = (file: string) => {
      const text = files[file];
      if (text === undefined) throw new Error('ENOENT');
      return text;
    };
    expect(readPidRegistries({ DATA_DIR: 'G:\\data' }, read)).toEqual([{ pid: 5, sessionId: 'abc' }]);
    expect(readPidRegistries({}, read)).toEqual([]);
  });
});
