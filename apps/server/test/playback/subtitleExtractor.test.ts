// @no-ffmpeg: the extractor's ffmpeg children are fakes that exit when the test says so.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EncoderExit, EncoderHandle } from '../../src/playback/encoderProcess.js';
import { PidRegistry } from '../../src/playback/pidRegistry.js';
import { SubtitleExtractor } from '../../src/playback/subtitleExtractor.js';
import { makeTempDir, removeDir } from '../helpers.js';

/** An extractor child that lives until the test ends it. */
class FakeExtractorProcess implements EncoderHandle {
  readonly pid = undefined;
  readonly exited: Promise<EncoderExit>;
  running = true;
  private finish!: (exit: EncoderExit) => void;

  constructor() {
    this.exited = new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  stop(): Promise<void> {
    this.exitWith(0);
    return Promise.resolve();
  }

  exitWith(code: number): void {
    if (!this.running) return;
    this.running = false;
    this.finish({ code, signal: null, stderrTail: 'fake extractor' });
  }
}

const dirs: string[] = [];
let extractor: SubtitleExtractor | null = null;
let peak = 0;

/** The most extractor processes that were alive at the same time since `boot`. */
const peakAlive = () => peak;

afterEach(async () => {
  await extractor?.stop();
  extractor = null;
  for (const dir of dirs.splice(0)) removeDir(dir);
});

const alive = (children: FakeExtractorProcess[]) => children.filter((child) => child.running).length;

function boot(maxRuns: number): { extractor: SubtitleExtractor; children: FakeExtractorProcess[] } {
  const dir = makeTempDir('extractor');
  dirs.push(dir);
  const children: FakeExtractorProcess[] = [];
  peak = 0;
  extractor = new SubtitleExtractor({
    ffmpegPath: 'no-such-ffmpeg',
    sessionId: 'session-1',
    sessionDir: dir,
    inputUrl: (runId) => `http://127.0.0.1/src/${runId}`,
    videoIndex: 0,
    durationSec: 7200,
    tracks: [3],
    maxRuns,
    registry: new PidRegistry(path.join(dir, 'pids.json')),
    onFailure: () => undefined,
    createProcess: () => {
      const child = new FakeExtractorProcess();
      children.push(child);
      peak = Math.max(peak, alive(children));
      return child;
    },
  });
  return { extractor, children };
}

/** Lets promise callbacks run without letting any file or timer work complete. */
async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('extractor capacity while a failed run is being reported', () => {
  it('does not start a demand run next to the retry of a failed run (two at once at most)', async () => {
    const { extractor: subject, children } = boot(2);
    subject.start(3600);
    subject.ensureExtractorFor(5000);
    await settleMicrotasks();
    expect(children).toHaveLength(2);

    // The process is gone, but the run reports its exit only after reading its last output.
    children[0]?.exitWith(1);
    subject.ensureExtractorFor(6500);
    await settleMicrotasks();
    expect(children).toHaveLength(2);

    // The demand run may take the place of the older seek run, but the retry and it never run next to a third process.
    await until(() => children.length >= 3);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(children)).toBeLessThanOrEqual(2);
    expect(peakAlive()).toBeLessThanOrEqual(2);
  });

  it('keeps a heavy source (one extractor) at one process while its failed run is retried', async () => {
    const { extractor: subject, children } = boot(1);
    subject.start(3600);
    expect(children).toHaveLength(1);

    children[0]?.exitWith(1);
    subject.ensureExtractorFor(5000);
    await settleMicrotasks();
    expect(children).toHaveLength(1);

    await until(() => children.length === 2);
    expect(alive(children)).toBe(1);
    expect(subject.processCount).toBe(1);
    expect(peakAlive()).toBe(1);
  });

  it('still starts a demand run once the retry has taken its place and a slot is free', async () => {
    const { extractor: subject, children } = boot(2);
    subject.start(3600);
    children[0]?.exitWith(1);
    await until(() => children.length === 2);

    subject.ensureExtractorFor(5000);
    await settleMicrotasks();

    expect(children).toHaveLength(3);
    expect(alive(children)).toBe(2);
  });
});
