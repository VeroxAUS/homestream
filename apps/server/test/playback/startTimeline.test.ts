// @no-ffmpeg: fake encoders and a stubbed probe; FFMPEG_PATH points nowhere, so the subtitle extractor cannot start a process either.
import path from 'node:path';
import { pino } from 'pino';
import type { Logger } from '../../src/logger.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProbeResult } from '../../src/playback/probe.js';
import { StartTimeline } from '../../src/playback/startTimeline.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { FakeEncoders } from './fakeEncoder.js';
import { bootHarness, startSession, type Harness } from './harness.js';

const PROBE: ProbeResult = {
  durationSec: 120,
  video: { index: 0, codec: 'h264', profile: 'High', width: 1920, height: 1080, pixFmt: 'yuv420p', fps: 24, hdr: 'sdr', dolbyVisionProfile: null },
  audio: [{ index: 1, codec: 'ac3', channels: 6, language: 'eng', title: '', default: true }],
  subtitles: [{ index: 2, codec: 'subrip', language: 'eng', title: '', kind: 'text', forced: false, default: false }],
};

interface Line {
  level: number;
  source?: string;
  step?: string;
  sessionId?: string;
  sinceStartMs?: number;
  msg: string;
}

const DEBUG = 20;

function captureLogger(level: string): { logger: Logger; lines: Line[] } {
  const lines: Line[] = [];
  const logger: Logger = pino({ level }, { write: (chunk: string) => void lines.push(JSON.parse(chunk) as Line) });
  return { logger, lines };
}

describe('StartTimeline', () => {
  it('logs the step, session and milliseconds since the request at debug level', () => {
    const { logger, lines } = captureLogger('debug');
    const timeline = new StartTimeline(logger, Date.now() - 1500);
    timeline.mark('probe done', 'abc');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: DEBUG, source: 'playback', step: 'probe done', sessionId: 'abc', msg: 'Start timing: probe done' });
    expect(lines[0]?.sinceStartMs).toBeGreaterThanOrEqual(1500);
    expect(lines[0]?.sinceStartMs).toBeLessThan(5000);
  });

  it('logs a step once per attempt', () => {
    const { logger, lines } = captureLogger('debug');
    const timeline = new StartTimeline(logger);
    timeline.mark('encoder spawned');
    timeline.mark('encoder spawned');
    timeline.nextAttempt().mark('encoder spawned');
    expect(lines).toHaveLength(2);
  });

  it('writes nothing at the default info level', () => {
    const { logger, lines } = captureLogger('info');
    new StartTimeline(logger).mark('encoder spawned');
    expect(lines).toHaveLength(0);
  });
});

describe('session start timing lines', () => {
  let root: string;
  const harnesses: Harness[] = [];

  beforeAll(() => {
    root = makeTempDir('start-timeline');
  });
  afterAll(async () => {
    for (const harness of harnesses) await harness.close();
    clearSecrets();
    removeDir(root);
  });

  it('logs every start step once, in order, with growing ms since the POST and nothing sensitive', async () => {
    const { logger, lines } = captureLogger('debug');
    const encoders = new FakeEncoders();
    const harness = await bootHarness({
      root: makeTempDir('inst'),
      sources: { movie: { filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', path: path.join(root, 'does-not-exist.mkv') } },
      probe: async () => PROBE,
      env: { FFMPEG_PATH: path.join(root, 'no-such-ffmpeg.exe') },
      playback: { createEncoder: encoders.create },
      logger,
    });
    harnesses.push(harness);

    const started = await startSession(harness, 'movie', 'desktop');
    expect(started.status).toBe(201);

    const timing = lines.filter((line) => line.step !== undefined);
    expect(timing.every((line) => line.level === DEBUG && line.source === 'playback' && line.sessionId === started.body.sessionId)).toBe(true);
    const steps = timing.map((line) => line.step);
    for (const step of ['stream picked', 'source acquired', 'probe done', 'head fill done', 'extractor started', 'encoder spawned', 'first segment written']) {
      expect(steps.filter((name) => name === step)).toHaveLength(1);
    }
    expect(steps.indexOf('stream picked')).toBeLessThan(steps.indexOf('source acquired'));
    expect(steps.indexOf('probe done')).toBeLessThan(steps.indexOf('encoder spawned'));
    expect(steps.indexOf('encoder spawned')).toBeLessThan(steps.indexOf('first segment written'));
    const times = timing.map((line) => line.sinceStartMs as number);
    expect(times.every((ms) => Number.isFinite(ms) && ms >= 0 && ms < 30_000)).toBe(true);
    const first = timing.find((line) => line.step === 'first segment written');
    expect(first?.sinceStartMs).toBeGreaterThanOrEqual(timing.find((line) => line.step === 'probe done')?.sinceStartMs as number);

    const text = JSON.stringify(timing);
    expect(text).not.toMatch(/https?:|127\.0\.0\.1|token|aiostreams/i);
  });
});
