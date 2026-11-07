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
const STARTED = Date.parse('2026-11-07T12:00:00Z');
const EXTRACTOR_URL = 'http://127.0.0.1:8600/src/k3y?o=tok3n&run=2';
/** The extractor command line has no session id: relative outputs, the loopback source URL and the generic `-f webvtt`. */
const EXTRACTOR_LINE = `ffmpeg.exe -hide_banner -y -i ${EXTRACTOR_URL} -map 0:3 -c:s webvtt -f webvtt subs\\run2\\3.vtt`;
const UNRELATED_WEBVTT_LINE = 'ffmpeg.exe -i C:\\clips\\captions.srt -f webvtt C:\\clips\\captions.vtt';

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
  const registry = [{ pid: 4321, sessionId: SESSION, startedAt: STARTED }];
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
    expect(
      parseFfmpegProcesses(JSON.stringify({ pid: 7, commandLine: 'ffmpeg.exe -i a', createdAtMs: STARTED })),
    ).toEqual([{ pid: 7, commandLine: 'ffmpeg.exe -i a', createdAtMs: STARTED }]);
    expect(
      parseFfmpegProcesses(
        JSON.stringify([
          { pid: 1, commandLine: null },
          { pid: 2, commandLine: '' },
          { pid: 'x', commandLine: 'junk' },
        ]),
      ),
    ).toEqual([
      { pid: 1, commandLine: null, createdAtMs: null },
      { pid: 2, commandLine: null, createdAtMs: null },
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

  it('uses the configured transcode and test roots', () => {
    const roots = ownedRoots({ TRANSCODE_DIR: 'F:\\media\\tc', HOMESTREAM_TEST_ROOT: 'F:\\tests' });
    expect(roots.slice(0, 2)).toEqual(['F:\\media\\tc', 'F:\\tests']);
    const custom = { pid: 8, commandLine: 'ffmpeg.exe -i x F:\\Media\\TC\\abc\\ffmpeg.m3u8' };
    expect(countFfmpeg([custom], { roots }).owned).toBe(1);
    const extractor = { pid: 9, commandLine: EXTRACTOR_LINE, createdAtMs: STARTED - 40 };
    const entry = { pid: 9, sessionId: SESSION, startedAt: STARTED, match: EXTRACTOR_URL };
    expect(countFfmpeg([extractor], { registry: [entry], roots }).owned).toBe(1);
    expect(countFfmpeg([extractor], { registry: [], roots }).owned).toBe(0);
  });

  it('keeps the busy threshold for an idle check without any ffmpeg', () => {
    const result = verdict({ ...idleFor([]), utilPct: MAX_IDLE_UTIL_PCT });
    expect(result.ok).toBe(false);
  });
});

describe('command-line ownership needs a path argument inside an owned root', () => {
  const roots = ownedRoots({});
  const busy = summarizeIdle([99, 98, 100, 97, 99]);
  const run = (commandLine: string, sources: Parameters<typeof countFfmpeg>[1] = { registry: [], roots }) =>
    countFfmpeg([{ pid: 77, commandLine, createdAtMs: STARTED }], sources);
  const verdict = (commandLine: string) =>
    evaluate({
      events: [],
      gpu: { tempC: 50 },
      memory: { freeGb: 12 },
      idle: { ...busy, ffmpegRunning: run(commandLine).owned > 0, processes: ['Wow.exe'] },
      errors: [],
    });

  it.each([
    ['transcode-backup', 'ffmpeg.exe -i C:\\clips\\in.mkv E:\\HomeStream\\transcode-backup\\out.mp4'],
    ['test-tmp-old', 'ffmpeg.exe -i C:\\clips\\in.mkv D:\\HomeStream\\test-tmp-old\\out.mp4'],
    ['transcode2', 'ffmpeg.exe -i C:\\clips\\in.mkv "E:\\HomeStream\\transcode2\\out.mp4"'],
    ['a parent traversal out of the root', 'ffmpeg.exe -i in.mkv E:\\HomeStream\\transcode\\..\\other\\out.mp4'],
    [
      'a root named inside a non-path argument',
      'ffmpeg.exe -i in.mkv -metadata comment=E:\\HomeStream\\transcode\\x x.mp4',
    ],
    ['a URL that merely mentions the root', 'ffmpeg.exe -i http://example.test/E:/HomeStream/transcode/a x.mp4'],
  ])('does not own a process whose path only shares a prefix with a root: %s', (_name, line) => {
    expect(run(line)).toEqual({ owned: 0, foreign: 1 });
    const result = verdict(line);
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/^gpu_busy: /);
  });

  it.each([
    ['backslashes', 'ffmpeg.exe -i in.mkv E:\\HomeStream\\transcode\\abc\\ffmpeg.m3u8'],
    ['forward slashes and other case', 'ffmpeg.exe -i in.mkv e:/homestream/Transcode/abc/ffmpeg.m3u8'],
    ['a quoted path', 'ffmpeg.exe -i in.mkv "D:\\HomeStream\\test-tmp\\run 1\\x.mp4"'],
    ['the root itself', 'ffmpeg.exe -i in.mkv -hls_base_url E:\\HomeStream\\transcode\\'],
    ['a dotted segment that stays inside', 'ffmpeg.exe -i in.mkv E:\\HomeStream\\transcode\\.\\a\\..\\b\\x.ts'],
    ['a file: URL', 'ffmpeg.exe -i in.mkv file:E:/HomeStream/test-tmp/a/x.mp4'],
  ])('still owns a process with a path inside a root: %s', (_name, line) => {
    expect(run(line)).toEqual({ owned: 1, foreign: 0 });
    expect(verdict(line).ok).toBe(true);
  });

  it('applies the same boundary to configured roots with spaces and trailing separators', () => {
    const custom = { registry: [], roots: ['F:\\My Media\\tc\\'] };
    expect(run('ffmpeg.exe -i in.mkv "F:\\My Media\\tc\\abc\\x.m3u8"', custom).owned).toBe(1);
    expect(run('ffmpeg.exe -i in.mkv "F:\\My Media\\tc-old\\abc\\x.m3u8"', custom).owned).toBe(0);
    expect(run('ffmpeg.exe -i in.mkv F:\\My Media\\tc\\abc\\x.m3u8', custom).owned).toBe(0);
  });
});

describe('the registry exemption needs session-specific identity', () => {
  const started = { pid: 9, sessionId: SESSION, startedAt: STARTED };
  const extractorEntry = { ...started, match: EXTRACTOR_URL };
  const count = (commandLine: string | null, entry: object, createdAtMs: number | null) =>
    countFfmpeg([{ pid: 9, commandLine, createdAtMs }], { registry: [entry as typeof started], roots: [] }).owned;

  it('does not own an unrelated WebVTT conversion that reused the pid of a stale extractor entry', () => {
    const generic = { ...started, match: 'webvtt' };
    expect(count(UNRELATED_WEBVTT_LINE, generic, STARTED + 3_600_000)).toBe(0);
    expect(count(UNRELATED_WEBVTT_LINE, generic, null)).toBe(0);
    expect(count(UNRELATED_WEBVTT_LINE, extractorEntry, STARTED + 3_600_000)).toBe(0);
  });

  it('does not own a stale entry whose process was created long after it was recorded, even with the marker', () => {
    expect(count(UNRELATED_WEBVTT_LINE, { ...started, match: 'webvtt' }, STARTED + 60_000)).toBe(0);
    expect(count(EXTRACTOR_LINE, extractorEntry, STARTED + 60_000)).toBe(0);
  });

  it('fails the busy-GPU check for that stale entry', () => {
    const idle = {
      ...summarizeIdle([99, 98, 100, 97, 99]),
      ffmpegRunning: count(UNRELATED_WEBVTT_LINE, { ...started, match: 'webvtt' }, STARTED + 3_600_000) > 0,
      processes: ['Wow.exe'],
    };
    const result = evaluate({ events: [], gpu: { tempC: 50 }, memory: { freeGb: 12 }, idle, errors: [] });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/^gpu_busy: /);
  });

  it('does not own a process with the right pid and a different command line', () => {
    expect(count(UNRELATED_LINE, extractorEntry, STARTED)).toBe(0);
    expect(count(UNRELATED_LINE, started, STARTED)).toBe(0);
  });

  it('owns a real extractor: its session-specific input URL and a creation time next to the recorded start', () => {
    expect(count(EXTRACTOR_LINE, extractorEntry, STARTED - 40)).toBe(1);
    expect(count(EXTRACTOR_LINE, extractorEntry, STARTED + 500)).toBe(1);
  });

  it('owns a real encoder recorded by session id, without needing a root', () => {
    expect(count(HOMESTREAM_LINE, started, STARTED - 25)).toBe(1);
    expect(count(HOMESTREAM_LINE, { ...started, sessionId: 'another-session' }, STARTED)).toBe(0);
  });

  it('does not take the registry on trust when the creation time is unknown', () => {
    expect(count(EXTRACTOR_LINE, extractorEntry, null)).toBe(0);
    expect(count(HOMESTREAM_LINE, started, null)).toBe(0);
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
