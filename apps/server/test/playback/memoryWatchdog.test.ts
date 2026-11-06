import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EncoderProcess } from '../../src/playback/encoderProcess.js';
import {
  MemoryWatchdog,
  createWorkingSetSampler,
  exceedsMemoryLimit,
  imageNameOf,
  parsePsRss,
  parseTasklistCsv,
} from '../../src/playback/memoryWatchdog.js';

const MIB = 1024 * 1024;
const NODE_IMAGE = path.basename(process.execPath);
const children: ChildProcess[] = [];

/** Node script that touches `mb` MiB and then idles; `quitOnQ` makes it exit on `q` like ffmpeg does. */
function hogScript(mb: number, quitOnQ: boolean): string {
  return [
    `const b = Buffer.alloc(${mb} * 1024 * 1024, 1); let s = 0; for (let i = 0; i < b.length; i += 4096) s += b[i];`,
    quitOnQ
      ? `process.stdin.on('data', (d) => { if (String(d).includes('q')) process.exit(0); });`
      : `process.stdin.resume();`,
    `setInterval(() => { s += b[0]; }, 1000);`,
  ].join('\n');
}

function startHog(mb: number): ChildProcess {
  const child = spawn(process.execPath, ['-e', hogScript(mb, false)], {
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true,
  });
  children.push(child);
  return child;
}

afterEach(() => {
  for (const child of children.splice(0)) {
    try {
      child.kill();
    } catch {
      // already gone
    }
  }
});

describe('exceedsMemoryLimit', () => {
  it.each([
    [0, 4096, false],
    [4095 * MIB, 4096, false],
    [4096 * MIB, 4096, false],
    [4096 * MIB + 1, 4096, true],
    [16 * 1024 * MIB, 4096, true],
    [101 * MIB, 100, true],
  ])('%d bytes against %d MiB is %s', (bytes, limit, expected) => {
    expect(exceedsMemoryLimit(bytes, limit)).toBe(expected);
  });
});

describe('parsers', () => {
  it('reads tasklist CSV rows with locale-specific thousands separators', () => {
    const out = [
      '"ffmpeg.exe","1234","Console","1","1,234,567 K"',
      '"ffmpeg.exe","77","Console","1","987.654 K"',
      '"ffmpeg.exe","88","Console","1","2 048 000 K"',
      'INFO: No tasks are running which match the specified criteria.',
      '',
    ].join('\r\n');
    expect(parseTasklistCsv(out)).toEqual(
      new Map([
        [1234, 1_234_567 * 1024],
        [77, 987_654 * 1024],
        [88, 2_048_000 * 1024],
      ]),
    );
  });

  it('reads ps rows', () => {
    expect(parsePsRss('  101  2048\n  7 5\nnot a row\n')).toEqual(
      new Map([
        [101, 2048 * 1024],
        [7, 5 * 1024],
      ]),
    );
  });

  it('derives the tasklist image name from the ffmpeg path', () => {
    expect(imageNameOf('ffmpeg')).toBe('ffmpeg.exe');
    expect(imageNameOf('C:\\tools\\FFMPEG.EXE')).toBe('FFMPEG.EXE');
  });
});

describe('MemoryWatchdog', () => {
  it('reports only the process above the limit, once, and stops watching it', async () => {
    const sizes = new Map([
      [1, 500 * MIB],
      [2, 5000 * MIB],
    ]);
    const hits: Array<{ pid: number; rssBytes: number; limitBytes: number }> = [];
    const watchdog = new MemoryWatchdog({ limitMb: 4096, sample: async () => new Map(sizes) });
    watchdog.watch(1, (hit) => hits.push(hit));
    watchdog.watch(2, (hit) => hits.push(hit));

    await watchdog.tick();
    await watchdog.tick();

    expect(hits).toEqual([{ pid: 2, rssBytes: 5000 * MIB, limitBytes: 4096 * MIB }]);
    expect(watchdog.size).toBe(1);
    expect(watchdog.peak(1)).toBe(500 * MIB);
    watchdog.close();
  });

  it('asks the sampler only for watched pids and does nothing when nothing is watched', async () => {
    const asked: number[][] = [];
    const watchdog = new MemoryWatchdog({
      limitMb: 100,
      sample: async (pids) => {
        asked.push(pids);
        return new Map();
      },
    });
    await watchdog.tick();
    const stop = watchdog.watch(9, () => undefined);
    await watchdog.tick();
    stop();
    await watchdog.tick();
    expect(asked).toEqual([[9]]);
    watchdog.close();
  });

  it('survives a failing sampler and skips overlapping rounds', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const watchdog = new MemoryWatchdog({
      limitMb: 100,
      sample: () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('tasklist failed'));
        return new Promise((resolve) => {
          release = () => resolve(new Map([[3, 1 * MIB]]));
        });
      },
    });
    watchdog.watch(3, () => undefined);
    await watchdog.tick();
    const slow = watchdog.tick();
    await watchdog.tick();
    expect(calls).toBe(2);
    release();
    await slow;
    expect(watchdog.peak(3)).toBe(1 * MIB);
    watchdog.close();
  });

  it('fires from its own timer', async () => {
    const hit = new Promise<number>((resolve) => {
      const watchdog = new MemoryWatchdog({
        limitMb: 10,
        intervalMs: 20,
        sample: async () => new Map([[5, 50 * MIB]]),
      });
      watchdog.watch(5, (info) => {
        watchdog.close();
        resolve(info.pid);
      });
    });
    expect(await hit).toBe(5);
  });
});

describe('working-set sampling of a real process', () => {
  it('reports the working set of a child that holds ~300 MiB', async () => {
    const child = startHog(300);
    const pid = child.pid as number;
    const sample = createWorkingSetSampler(NODE_IMAGE);
    let bytes = 0;
    for (let attempt = 0; attempt < 20 && bytes < 250 * MIB; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      bytes = (await sample([pid])).get(pid) ?? 0;
    }
    expect(bytes).toBeGreaterThan(250 * MIB);
    expect(bytes).toBeLessThan(1024 * MIB);
  }, 15_000);

  it('omits pids that no longer exist', async () => {
    const sample = createWorkingSetSampler(NODE_IMAGE);
    expect((await sample([2_000_000_000])).size).toBe(0);
  });
});

describe('EncoderProcess with the watchdog', () => {
  async function runHog(quitOnQ: boolean, limitMb: number) {
    const hog = ['-e', hogScript(300, quitOnQ)];
    const watchdog = new MemoryWatchdog({ limitMb, intervalMs: 200, sample: createWorkingSetSampler(NODE_IMAGE) });
    let limitCallbacks = 0;
    const started = Date.now();
    const proc = new EncoderProcess({
      ffmpegPath: process.execPath,
      args: hog,
      cwd: process.cwd(),
      onProgress: () => undefined,
      watchdog,
      onMemoryLimit: () => {
        limitCallbacks += 1;
      },
    });
    const exit = await Promise.race([
      proc.exited,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('process was not stopped')), 20_000)),
    ]);
    watchdog.close();
    return { exit, limitCallbacks, elapsedMs: Date.now() - started, watched: watchdog.size };
  }

  it('stops a process over the limit with q and reports memoryLimit on its exit', async () => {
    const { exit, limitCallbacks } = await runHog(true, 150);
    expect(limitCallbacks).toBe(1);
    expect(exit.memoryLimit?.pid).toBeGreaterThan(0);
    expect(exit.memoryLimit?.rssBytes).toBeGreaterThan(150 * MIB);
    expect(exit.memoryLimit?.limitBytes).toBe(150 * MIB);
    expect(exit.code).toBe(0);
  }, 30_000);

  it('kills a process that ignores q after the 2 s grace period', async () => {
    const { exit, limitCallbacks, elapsedMs } = await runHog(false, 150);
    expect(limitCallbacks).toBe(1);
    expect(exit.memoryLimit).toBeDefined();
    expect(exit.code).not.toBe(0);
    expect(elapsedMs).toBeGreaterThan(1900);
  }, 30_000);

  it('leaves a process under the limit alone and stops watching it when it exits', async () => {
    const watchdog = new MemoryWatchdog({
      limitMb: 4096,
      intervalMs: 100,
      sample: createWorkingSetSampler(NODE_IMAGE),
    });
    const proc = new EncoderProcess({
      ffmpegPath: process.execPath,
      args: ['-e', 'setTimeout(() => process.exit(0), 600)'],
      cwd: process.cwd(),
      onProgress: () => undefined,
      watchdog,
    });
    const exit = await proc.exited;
    expect(exit.code).toBe(0);
    expect(exit.memoryLimit).toBeUndefined();
    expect(watchdog.size).toBe(0);
    watchdog.close();
  }, 15_000);
});
