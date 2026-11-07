// @no-ffmpeg: the extractor's ffmpeg children are fakes that only write the coverage listing a real run would.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EncoderProcessOptions } from '../../src/playback/encoderProcess.js';
import { PidRegistry } from '../../src/playback/pidRegistry.js';
import { PREROLL_SEC, SubtitleExtractor } from '../../src/playback/subtitleExtractor.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { FakeEncoder } from './fakeEncoder.js';

const HOLD = 176;
const RESUME = 120;

interface Child {
  handle: FakeEncoder;
  ss: number;
  /** Moves the head the run reports (absolute source seconds). */
  moveHead(sec: number): void;
}

const dirs: string[] = [];
let subject: SubtitleExtractor | null = null;

afterEach(async () => {
  await subject?.stop();
  subject = null;
  for (const dir of dirs.splice(0)) removeDir(dir);
});

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function boot(options: { maxRuns?: number } = {}) {
  const dir = makeTempDir('ext-window');
  dirs.push(dir);
  const children: Child[] = [];
  const holds = new Map<number, boolean>();
  let playhead = 0;
  let peakAlive = 0;
  const extractor = new SubtitleExtractor({
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
    readAhead: {
      holdSec: HOLD,
      resumeSec: RESUME,
      playheadSec: () => playhead,
      setHold: (runId, held) => holds.set(runId, held),
    },
    createProcess: (processOptions: EncoderProcessOptions) => {
      const handle = new FakeEncoder('hang', processOptions);
      const at = processOptions.args.indexOf('-ss');
      const ss = at < 0 ? 0 : Number(processOptions.args[at + 1]);
      const cover = path.join(dir, processOptions.args.find((arg) => arg.endsWith('cover.txt')) as string);
      mkdirSync(path.dirname(cover), { recursive: true });
      const moveHead = (sec: number): void => {
        writeFileSync(cover, `#tb 0: 1/1000\n0, ${Math.round(sec * 1000)}, ${Math.round(sec * 1000)}, 40, 100, 0x0\n`);
      };
      moveHead(ss);
      children.push({ handle, ss, moveHead });
      peakAlive = Math.max(peakAlive, children.filter((child) => child.handle.running).length);
      return handle;
    },
  });
  subject = extractor;
  return {
    extractor,
    children,
    holds,
    movePlayhead: (sec: number) => {
      playhead = sec;
    },
    peakAlive: () => peakAlive,
    alive: () => children.filter((child) => child.handle.running),
  };
}

/** Waits until the extractor has noticed the head the fake wrote (the run polls its coverage file). */
async function headReaches(extractor: SubtitleExtractor, sec: number): Promise<void> {
  await until(() => extractor.readPositions.some((run) => run.headSec >= sec));
}

describe('extractor hold by read position', () => {
  it('holds a run whose head is a full window past the player even though the run started far ahead of it', async () => {
    const rig = boot();
    rig.extractor.start(600);
    const child = rig.children[0] as Child;
    child.moveHead(610);
    await headReaches(rig.extractor, 610);
    // The player is at 0 (a seek back); the old max(player, run start) rule measured from 588 and never held this run.
    await until(() => rig.holds.get(1) === true);
    expect(rig.extractor.readPositions).toEqual([expect.objectContaining({ runId: 1, held: true })]);
  });

  it('does not hold a run below the window and releases a held one once the player is within the resume lead', async () => {
    const rig = boot();
    rig.extractor.start(0);
    const child = rig.children[0] as Child;
    child.moveHead(HOLD - 1);
    await headReaches(rig.extractor, HOLD - 1);
    expect(rig.holds.has(1)).toBe(false);
    child.moveHead(HOLD + 20);
    await until(() => rig.holds.get(1) === true);
    rig.movePlayhead(HOLD + 20 - RESUME + 1);
    rig.extractor.syncHolds();
    expect(rig.holds.get(1)).toBe(false);
  });
});

describe('extractor after a far seek', () => {
  it('stops the run left behind a forward seek, leaves nothing reading below the player, and starts a new run on demand', async () => {
    const rig = boot();
    rig.extractor.start(0);
    (rig.children[0] as Child).moveHead(400);
    await headReaches(rig.extractor, 400);

    rig.movePlayhead(3600);
    rig.extractor.noteSeek(3600);
    await until(() => rig.alive().length === 0);
    expect(rig.extractor.readPositions).toEqual([]);

    rig.extractor.ensureExtractorFor(3600);
    await until(() => rig.children.length === 2);
    expect((rig.children[1] as Child).ss).toBe(3600 - PREROLL_SEC);
    for (const run of rig.extractor.readPositions) expect(run.headSec).toBeGreaterThanOrEqual(3600 - PREROLL_SEC);
  });

  it('stops a run that is far past a backward seek, and holds nothing it does not have to', async () => {
    const rig = boot();
    rig.extractor.start(3600);
    (rig.children[0] as Child).moveHead(3700);
    await headReaches(rig.extractor, 3700);

    rig.movePlayhead(100);
    rig.extractor.noteSeek(100);
    await until(() => rig.alive().length === 0);

    rig.extractor.ensureExtractorFor(100);
    await until(() => rig.children.length === 2);
    expect((rig.children[1] as Child).ss).toBe(100 - PREROLL_SEC);
  });

  it('keeps a run that already reads towards the seek position', async () => {
    const rig = boot();
    rig.extractor.start(0);
    (rig.children[0] as Child).moveHead(150);
    await headReaches(rig.extractor, 150);
    rig.movePlayhead(100);
    rig.extractor.noteSeek(100);
    expect(rig.alive()).toHaveLength(1);
  });

  it('stops a run that falls too far behind the player without a seek notice', async () => {
    const rig = boot();
    rig.extractor.start(0);
    (rig.children[0] as Child).moveHead(50);
    await headReaches(rig.extractor, 50);
    rig.movePlayhead(160);
    rig.extractor.syncHolds();
    expect(rig.alive()).toHaveLength(1);
    rig.movePlayhead(300);
    rig.extractor.syncHolds();
    await until(() => rig.alive().length === 0);
  });

  it('does not start a run for a position far behind the player', async () => {
    const rig = boot();
    rig.extractor.start(0);
    rig.movePlayhead(1000);
    rig.extractor.noteSeek(1000);
    await until(() => rig.alive().length === 0);
    rig.extractor.ensureExtractorFor(100);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(rig.children).toHaveLength(1);
  });

  it('waits for the stopped run to leave before starting the replacement when only one extractor may run', async () => {
    const rig = boot({ maxRuns: 1 });
    rig.extractor.start(0);
    const first = (rig.children[0] as Child).handle;
    const release = first.holdStop();
    rig.movePlayhead(3600);
    rig.extractor.noteSeek(3600);
    rig.extractor.ensureExtractorFor(3600);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(rig.children).toHaveLength(1);
    release();
    await until(() => rig.children.length === 2);
    expect(rig.peakAlive()).toBe(1);
  });
});
