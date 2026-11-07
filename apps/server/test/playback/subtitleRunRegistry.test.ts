// @no-ffmpeg: the extractor child is a fake with a made-up pid.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EncoderExit, EncoderHandle } from '../../src/playback/encoderProcess.js';
import { PidRegistry } from '../../src/playback/pidRegistry.js';
import { buildExtractArgs, SubtitleRun } from '../../src/playback/subtitleRun.js';
import { makeTempDir, removeDir } from '../helpers.js';

class FakeChild implements EncoderHandle {
  readonly exited: Promise<EncoderExit>;
  running = true;
  private finish!: (exit: EncoderExit) => void;

  constructor(readonly pid: number) {
    this.exited = new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  stop(): Promise<void> {
    this.running = false;
    this.finish({ code: 0, signal: null, stderrTail: '' });
    return Promise.resolve();
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
});

describe('extractor pid registry entry', () => {
  it('records the run input URL, which is on the command line and specific to the session, not the generic output format', async () => {
    const dir = makeTempDir('extractor-registry');
    dirs.push(dir);
    const registry = new PidRegistry(path.join(dir, 'pids.json'));
    const inputUrl = 'http://127.0.0.1:8600/src/k3y?o=tok3n&run=4';
    const job = { inputUrl, ss: 0, videoIndex: 0, tracks: [3], outputDir: path.join('subs', 'run4') };
    const before = Date.now();
    const run = new SubtitleRun({
      ...job,
      id: 4,
      kind: 'main',
      ffmpegPath: 'no-such-ffmpeg',
      sessionId: 'session-1',
      sessionDir: dir,
      registry,
      retried: false,
      createProcess: () => new FakeChild(4242),
      onCues: () => undefined,
      onUpdate: () => undefined,
      onExit: () => undefined,
    });

    const [entry] = registry.list();
    expect(entry).toMatchObject({ pid: 4242, sessionId: 'session-1', match: inputUrl });
    expect(entry?.startedAt).toBeGreaterThanOrEqual(before);
    expect(entry?.match).not.toBe('webvtt');
    expect(buildExtractArgs(job)).toContain(inputUrl);

    await run.stop();
    expect(registry.list()).toEqual([]);
  });
});
