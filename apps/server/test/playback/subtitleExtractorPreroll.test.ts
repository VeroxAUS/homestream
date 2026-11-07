// @no-ffmpeg: the extractor's ffmpeg children are fakes that only write the coverage listing a real run would.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EncoderExit, EncoderHandle, EncoderProcessOptions } from '../../src/playback/encoderProcess.js';
import { PidRegistry } from '../../src/playback/pidRegistry.js';
import { SEGMENT_SECONDS } from '../../src/playback/playlist.js';
import { PREROLL_SEC, SubtitleExtractor, prerollStart } from '../../src/playback/subtitleExtractor.js';
import { makeTempDir, removeDir } from '../helpers.js';

/** The longest a cue can start before a seek point and still be dropped by the seek (see `MAX_CUE_SEC` in subtitleRun). */
const MAX_CUE_SEC = 10;

class FakeProcess implements EncoderHandle {
  readonly pid = undefined;
  readonly exited: Promise<EncoderExit>;
  running = true;
  private finish!: (exit: EncoderExit) => void;

  constructor(readonly args: string[]) {
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

  get ss(): number | null {
    const at = this.args.indexOf('-ss');
    return at < 0 ? null : Number(this.args[at + 1]);
  }
}

const dirs: string[] = [];
let subject: SubtitleExtractor | null = null;

afterEach(async () => {
  await subject?.stop();
  subject = null;
  for (const dir of dirs.splice(0)) removeDir(dir);
});

interface Rig {
  extractor: SubtitleExtractor;
  children: FakeProcess[];
  starts: Array<{ kind: string; ss: number }>;
}

/** A fake extractor whose coverage listing reaches `headAhead` seconds past the run's start as soon as it exists. */
function boot(options: { maxRuns?: number; headAhead?: number } = {}): Rig {
  const dir = makeTempDir('preroll');
  dirs.push(dir);
  const children: FakeProcess[] = [];
  const starts: Rig['starts'] = [];
  subject = new SubtitleExtractor({
    ffmpegPath: 'no-such-ffmpeg',
    sessionId: 'session-1',
    sessionDir: dir,
    inputUrl: (runId) => `http://127.0.0.1/src/${runId}`,
    videoIndex: 0,
    durationSec: 7200,
    tracks: [3],
    maxRuns: options.maxRuns ?? 2,
    registry: new PidRegistry(path.join(dir, 'pids.json')),
    onFailure: () => undefined,
    onRunEvent: (event) => {
      if (event.event === 'start') starts.push({ kind: event.kind, ss: event.ss });
    },
    createProcess: (processOptions: EncoderProcessOptions) => {
      const child = new FakeProcess(processOptions.args);
      children.push(child);
      const headAhead = options.headAhead;
      if (headAhead !== undefined) {
        const cover = processOptions.args.find((arg) => arg.endsWith('cover.txt')) as string;
        mkdirSync(path.dirname(path.join(dir, cover)), { recursive: true });
        const head = (child.ss ?? 0) + headAhead;
        writeFileSync(
          path.join(dir, cover),
          `#tb 0: 1/1000\n0, ${Math.round(head * 1000)}, ${Math.round(head * 1000)}, 40, 100, 0x0\n`,
        );
      }
      return child;
    },
  });
  return { extractor: subject, children, starts };
}

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('PREROLL_SEC', () => {
  it('is about 12 s: inside the tuning range and above the longest cue the seek can drop', () => {
    expect(PREROLL_SEC).toBeGreaterThanOrEqual(10);
    expect(PREROLL_SEC).toBeLessThanOrEqual(15);
    expect(PREROLL_SEC).toBeGreaterThanOrEqual(MAX_CUE_SEC);
  });
});

describe('prerollStart', () => {
  it.each([
    { sec: 0, start: 0 },
    { sec: 11.9, start: 0 },
    { sec: 16, start: 4 },
    { sec: 600, start: 588 },
    { sec: 3600, start: 3588 },
    { sec: 3601.7, start: 3588 },
    { sec: 3603.9, start: 3588 },
    { sec: 3604, start: 3592 },
  ])('starts a run for $sec s at $start s', ({ sec, start }) => {
    expect(prerollStart(sec)).toBe(start);
  });

  it('puts the start PREROLL_SEC before the segment holding the position, never after it', () => {
    for (let sec = 0; sec < 400; sec += 0.7) {
      const segmentStart = Math.floor(sec / SEGMENT_SECONDS) * SEGMENT_SECONDS;
      expect(prerollStart(sec)).toBe(Math.max(0, segmentStart - PREROLL_SEC));
      expect(prerollStart(sec)).toBeLessThanOrEqual(sec);
    }
  });
});

describe('extractor run start positions', () => {
  it('starts the main run PREROLL_SEC before the start position (-ss on the command line)', () => {
    const { extractor, children, starts } = boot();
    extractor.start(3600);
    expect(starts).toEqual([{ kind: 'main', ss: 3600 - PREROLL_SEC }]);
    expect(children[0]?.ss).toBe(3600 - PREROLL_SEC);
  });

  it('starts the main run at the segment holding a resume position that is not on a segment boundary', () => {
    const { extractor, starts } = boot();
    extractor.start(3603.9);
    expect(starts).toEqual([{ kind: 'main', ss: 3600 - PREROLL_SEC }]);
  });

  it('reads from the beginning when the start position is within the preroll', () => {
    const { extractor, children, starts } = boot();
    extractor.start(5);
    expect(starts).toEqual([{ kind: 'main', ss: 0 }]);
    expect(children[0]?.ss).toBeNull();
  });

  it('starts a seek run PREROLL_SEC before the requested segment', async () => {
    const { extractor, starts } = boot();
    extractor.start(0);
    extractor.ensureExtractorFor(5000);
    await until(() => starts.length === 2);
    expect(starts[1]).toEqual({ kind: 'seek', ss: 5000 - PREROLL_SEC });
  });

  it('retries a failed run from further back than a fresh run so its coverage joins the failed run', async () => {
    const { extractor, children, starts } = boot();
    extractor.start(3600);
    children[0]?.exitWith(1);
    await until(() => starts.length === 2);
    const retry = starts[1] as { ss: number };
    // The failed run committed nothing (head = ss), so its coverage ended at ss - 6 and the retry's trusted part starts at its ss + 10.
    expect(retry.ss + MAX_CUE_SEC).toBeLessThanOrEqual(3600 - PREROLL_SEC - 6);
  });
});

describe('cue coverage of the segments the player asks for first', () => {
  it.each([0, 1, 5.5, 3600, 3601.7, 3603.9, 3611.2, 5000])(
    'covers every segment from the one holding %s s to 60 s later once the run has read 80 s',
    async (startSec) => {
      const { extractor } = boot({ headAhead: 12 + 80 });
      extractor.start(startSec);
      const first = Math.floor(startSec / SEGMENT_SECONDS);
      const last = Math.floor((startSec + 60) / SEGMENT_SECONDS);
      await until(() => extractor.store.segmentCovered(last));
      for (let k = first; k <= last; k += 1) expect(extractor.store.segmentCovered(k), `segment ${k}`).toBe(true);
    },
  );

  it('would leave the first segment uncovered if the run started PREROLL_SEC before an unaligned position', () => {
    // The run's trusted coverage begins 10 s after its start. Without aligning to the segment, 3603.9 - 12 = 3591.9 -> 3591, trusted from 3601 > 3600.
    expect(Math.floor(3603.9 - PREROLL_SEC) + MAX_CUE_SEC).toBeGreaterThan(
      Math.floor(3603.9 / SEGMENT_SECONDS) * SEGMENT_SECONDS,
    );
    expect(prerollStart(3603.9) + MAX_CUE_SEC).toBeLessThanOrEqual(
      Math.floor(3603.9 / SEGMENT_SECONDS) * SEGMENT_SECONDS,
    );
  });
});
