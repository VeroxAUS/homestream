// @no-ffmpeg: fake encoders and a stubbed probe; nothing here starts ffmpeg or touches the GPU.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ActivityResponse, SessionResponse } from '@homestream/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors.js';
import type { ProbeResult } from '../../src/playback/probe.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { FakeEncoders } from './fakeEncoder.js';
import { bootHarness, PROFILES, type Harness, type HarnessOptions, type ProfileName } from './harness.js';

const PROBE: ProbeResult = {
  durationSec: 120,
  video: { index: 0, codec: 'h264', profile: 'High', width: 1920, height: 1080, pixFmt: 'yuv420p', fps: 24, hdr: 'sdr', dolbyVisionProfile: null },
  audio: [{ index: 1, codec: 'ac3', channels: 6, language: 'eng', title: '', default: true }],
  subtitles: [],
};

const corruptProbe = () => new AppError(422, 'no_video_stream', 'The selected file has no playable video stream.', 'Try again.');
const notCached = () => new AppError(409, 'stream_not_cached', 'This stream is not cached on TorBox yet.', 'Try again later.');

let root: string;
const harnesses: Harness[] = [];

beforeAll(() => {
  root = makeTempDir('fallback');
});

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
});

afterAll(() => {
  clearSecrets();
  removeDir(root);
});

interface Setup {
  names: string[];
  /** Candidate index (gateway order) whose link cannot be resolved. */
  resolveFails?: Record<number, () => AppError>;
  /** Call numbers (0-based, in start order) of ffprobe that fail. */
  probeFails?: number[];
  encoders?: FakeEncoders;
  playback?: HarnessOptions['playback'];
}

async function boot(setup: Setup): Promise<{ harness: Harness; encoders: FakeEncoders; resolved: number[] }> {
  const encoders = setup.encoders ?? new FakeEncoders();
  const resolved: number[] = [];
  let probes = 0;
  const sources = Object.fromEntries(
    setup.names.map((name, i) => [`s${i}`, { filename: `Movie.1994.${name}.mkv`, path: path.join(root, `s${i}.mkv`) }]),
  );
  const harness = await bootHarness({
    root: makeTempDir('inst'),
    sources,
    probe: async () => {
      const call = probes;
      probes += 1;
      if (setup.probeFails?.includes(call)) throw corruptProbe();
      return PROBE;
    },
    playback: {
      createEncoder: encoders.create,
      resolveUrl: async (raw) => {
        const index = Number(/token(\d+)\//.exec(raw)?.[1]);
        resolved.push(index);
        const fail = setup.resolveFails?.[index];
        if (fail) throw fail();
        return path.join(root, `s${index}.mkv`);
      },
      ...setup.playback,
    },
  });
  harnesses.push(harness);
  return { harness, encoders, resolved };
}

const post = (harness: Harness, streamId: string, profile: ProfileName = 'chromecast4k') =>
  harness.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { mediaType: 'movie', tmdbId: 278, streamId, device: PROFILES[profile], subtitle: null },
  });

const sessionDirs = (harness: Harness): string[] => (existsSync(harness.transcodeDir) ? readdirSync(harness.transcodeDir) : []);
const count = (harness: Harness, sql: string): number => (harness.db.prepare(sql).get() as { n: number }).n;
const SAME = ['1080p.WEB-DL.x264-A', '1080p.WEB-DL.x264-B', '1080p.WEB-DL.x264-C', '1080p.WEB-DL.x264-D'];

async function expectNothingLeftExcept(harness: Harness, encoders: FakeEncoders, played: SessionResponse, failedEncoders: number[]): Promise<void> {
  expect(sessionDirs(harness)).toEqual([played.sessionId]);
  expect(((await harness.app.inject('/api/activity')).json() as ActivityResponse).sessions.map((s) => s.sessionId)).toEqual([played.sessionId]);
  expect(harness.app.ctx.playback.list().map((s) => s.sessionId)).toEqual([played.sessionId]);
  expect(harness.db.prepare('SELECT session_id, status FROM plays').all()).toEqual([{ session_id: played.sessionId, status: 'ok' }]);
  expect(count(harness, "SELECT COUNT(*) AS n FROM events WHERE level = 'error'")).toBe(0);
  for (const index of failedEncoders) expect(encoders.handles[index]?.running, `encoder ${index}`).toBe(false);
  expect(encoders.handles.filter((handle) => handle.running)).toHaveLength(1);
}

describe('automatic start with fallback', () => {
  it('plays the best-ranked stream with an empty attempts list when it works', async () => {
    const { harness, resolved } = await boot({ names: SAME });
    const res = await post(harness, 'auto');
    expect(res.statusCode).toBe(201);
    const body = res.json() as SessionResponse;
    expect(body).toMatchObject({ streamId: harness.streamIds.s0, attempts: [] });
    expect(resolved).toEqual([0]);
    expect(body.state).toMatch(/ready|starting/);
    expect(existsSync(path.join(harness.transcodeDir, body.sessionId, 'seg-0.m4s'))).toBe(true);
    expect((await harness.app.inject(`/api/sessions/${body.sessionId}`)).json()).toMatchObject({ streamId: harness.streamIds.s0, attempts: [] });
  });

  it('falls back when the link is a gateway placeholder, and reports its code', async () => {
    const { harness, encoders, resolved } = await boot({ names: SAME, resolveFails: { 0: notCached } });
    const res = await post(harness, 'auto');
    expect(res.statusCode).toBe(201);
    const body = res.json() as SessionResponse;
    expect(body.streamId).toBe(harness.streamIds.s1);
    expect(body.attempts).toEqual([{ streamId: harness.streamIds.s0, code: 'stream_not_cached' }]);
    expect(resolved).toEqual([0, 1]);
    expect(encoders.started).toBe(1);
    expect(harness.db.prepare('SELECT stream_filename FROM plays').all()).toEqual([{ stream_filename: 'Movie.1994.1080p.WEB-DL.x264-B.mkv' }]);
    await expectNothingLeftExcept(harness, encoders, body, []);
  });

  it('falls back when ffprobe cannot read the source, releasing its proxy entry', async () => {
    const { harness, encoders } = await boot({ names: SAME, probeFails: [0] });
    const res = await post(harness, 'auto');
    expect(res.statusCode).toBe(201);
    const body = res.json() as SessionResponse;
    expect(body.streamId).toBe(harness.streamIds.s1);
    expect(body.attempts).toEqual([{ streamId: harness.streamIds.s0, code: 'no_video_stream' }]);
    expect(encoders.started).toBe(1);
    expect(harness.probeCalls).toHaveLength(2);
    const failedKey = new URL(harness.probeCalls[0] as string);
    expect((await fetch(failedKey)).status).toBe(404);
    await expectNothingLeftExcept(harness, encoders, body, []);
  });

  it('falls back when the encoder dies before its first segment (including its own retry) and cleans up the failed attempt', async () => {
    // The first two encoders are the attempt and its automatic retry.
    const encoders = new FakeEncoders((index) => (index < 2 ? 'fail' : 'run'));
    const { harness } = await boot({ names: SAME, encoders });
    const res = await post(harness, 'auto');
    expect(res.statusCode).toBe(201);
    const body = res.json() as SessionResponse;
    expect(body.streamId).toBe(harness.streamIds.s1);
    expect(body.attempts).toEqual([{ streamId: harness.streamIds.s0, code: 'encoder_failed' }]);
    expect(encoders.started).toBe(3);
    expect(existsSync(encoders.cwds[0] as string)).toBe(false);
    await expectNothingLeftExcept(harness, encoders, body, [0, 1]);
    expect((await fetch(new URL(harness.probeCalls[0] as string))).status).toBe(404);
  });

  it('falls back when the encoder produces nothing within the wait', async () => {
    const encoders = new FakeEncoders((index) => (index === 0 ? 'hang' : 'run'));
    const { harness } = await boot({ names: SAME, encoders, playback: { firstSegmentWaitMs: 300 } });
    const res = await post(harness, 'auto');
    expect(res.statusCode).toBe(201);
    const body = res.json() as SessionResponse;
    expect(body.attempts).toEqual([{ streamId: harness.streamIds.s0, code: 'encoder_timeout' }]);
    await expectNothingLeftExcept(harness, encoders, body, [0]);
  });

  it('gives up after three attempts with 502 all_streams_failed and leaves nothing behind', async () => {
    const encoders = new FakeEncoders('fail');
    const { harness, resolved } = await boot({ names: SAME, encoders });
    const res = await post(harness, 'auto');
    expect(res.statusCode).toBe(502);
    const body = res.json() as { error: Record<string, unknown>; attempts: unknown };
    const attempts = [0, 1, 2].map((i) => ({ streamId: harness.streamIds[`s${i}`], code: 'encoder_failed' }));
    expect(body.error).toMatchObject({ code: 'all_streams_failed', message: expect.any(String), hint: expect.any(String), attempts });
    expect(body.attempts).toEqual(attempts);
    expect(JSON.stringify(body)).not.toMatch(/https?:|token\d/);
    expect(resolved).toEqual([0, 1, 2]);
    expect(encoders.started).toBe(6);
    expect(encoders.handles.every((handle) => !handle.running)).toBe(true);
    expect(sessionDirs(harness)).toEqual([]);
    expect(harness.app.ctx.playback.list()).toEqual([]);
    expect(count(harness, 'SELECT COUNT(*) AS n FROM plays')).toBe(0);
    expect(count(harness, "SELECT COUNT(*) AS n FROM events WHERE level = 'error'")).toBe(0);
    // The failed starts hold no slot.
    const again = await post(harness, harness.streamIds.s3 as string);
    expect(again.statusCode).toBe(502);
    expect(encoders.started).toBe(8);
  });

  it('lists only the candidates that exist when fewer than three are cached', async () => {
    const { harness } = await boot({ names: SAME.slice(0, 2), encoders: new FakeEncoders('fail') });
    const res = await post(harness, 'auto');
    expect(res.statusCode).toBe(502);
    expect((res.json() as { attempts: unknown[] }).attempts).toHaveLength(2);
  });

  it('reports a placeholder-only stream as all_streams_failed naming the mapped code', async () => {
    const { harness, encoders } = await boot({ names: SAME.slice(0, 1), resolveFails: { 0: notCached } });
    const res = await post(harness, 'auto');
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'all_streams_failed' }, attempts: [{ streamId: harness.streamIds.s0, code: 'stream_not_cached' }] });
    expect(encoders.started).toBe(0);
    expect(harness.probeCalls).toEqual([]);
    expect(sessionDirs(harness)).toEqual([]);
  });

  it('never tries a stream above the device resolution', async () => {
    const { harness, resolved } = await boot({
      names: ['2160p.WEB-DL.x265-A', '1080p.WEB-DL.x264-B', '1080p.Remux.x264-C', '720p.WEB-DL.x264-D', '480p.WEB-DL.x264-E'],
      resolveFails: { 1: notCached },
    });
    const res = await post(harness, 'auto', 'emulator');
    expect(res.statusCode).toBe(201);
    const body = res.json() as SessionResponse;
    // 1080p WEB-DL fails, the 1080p Remux plays; the 2160p stream is not a candidate for a 1080p device.
    expect(body.streamId).toBe(harness.streamIds.s2);
    expect(body.attempts).toEqual([{ streamId: harness.streamIds.s1, code: 'stream_not_cached' }]);
    expect(resolved).toEqual([1, 2]);
  });

  it('does not fall back for a bad audio track request', async () => {
    const { harness, resolved, encoders } = await boot({ names: SAME });
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { mediaType: 'movie', tmdbId: 278, streamId: 'auto', device: PROFILES.chromecast4k, audioIndex: 9 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'invalid_audio_index' } });
    expect(resolved).toEqual([0]);
    expect(encoders.started).toBe(0);
    expect(sessionDirs(harness)).toEqual([]);
    expect(count(harness, 'SELECT COUNT(*) AS n FROM plays')).toBe(0);
  });
});

describe('explicit stream id', () => {
  it('gets one attempt and its own error, without trying the other streams', async () => {
    const { harness, resolved, encoders } = await boot({ names: SAME, probeFails: [0] });
    const res = await post(harness, harness.streamIds.s0 as string);
    expect(res.statusCode).toBe(422);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ error: { code: 'no_video_stream' } });
    expect(body).not.toHaveProperty('attempts');
    expect(resolved).toEqual([0]);
    expect(encoders.started).toBe(0);
    expect(sessionDirs(harness)).toEqual([]);
    expect(count(harness, 'SELECT COUNT(*) AS n FROM plays')).toBe(0);

    const ok = await post(harness, harness.streamIds.s1 as string);
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ streamId: harness.streamIds.s1, attempts: [] });
    expect(resolved).toEqual([0, 1]);
  });

  it('waits for the first segment and fails with 502 encoder_failed, cleaning up', async () => {
    const encoders = new FakeEncoders('fail');
    const { harness } = await boot({ names: SAME, encoders });
    const res = await post(harness, harness.streamIds.s0 as string);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'encoder_failed', hint: expect.any(String) } });
    expect(res.json()).not.toHaveProperty('attempts');
    expect(encoders.started).toBe(2);
    expect(sessionDirs(harness)).toEqual([]);
    expect(count(harness, 'SELECT COUNT(*) AS n FROM plays')).toBe(0);
  });

  it('does not answer 201 before the first segment exists', async () => {
    const encoders = new FakeEncoders('hang');
    const { harness } = await boot({ names: SAME, encoders, playback: { firstSegmentWaitMs: 400 } });
    const started = Date.now();
    const res = await post(harness, harness.streamIds.s0 as string);
    expect(Date.now() - started).toBeGreaterThanOrEqual(380);
    expect(res.statusCode).toBe(504);
    expect(res.json()).toMatchObject({ error: { code: 'encoder_timeout' } });
    expect(encoders.handles.every((handle) => !handle.running)).toBe(true);
    expect(sessionDirs(harness)).toEqual([]);
  });
});

describe('concurrent starts', () => {
  it('does not count a start that is still opening twice against the session limit', async () => {
    const encoders = new FakeEncoders((index) => (index === 0 ? 'hang' : 'run'));
    const { harness } = await boot({ names: SAME, encoders, playback: { firstSegmentWaitMs: 1500, maxSessions: 2 } });
    const slow = post(harness, harness.streamIds.s0 as string, 'desktop');
    await new Promise((resolve) => setTimeout(resolve, 200));
    // One start is opening and one session runs: that is two, so a third is refused, but the second is not.
    const second = await post(harness, harness.streamIds.s1 as string, 'emulator');
    expect(second.statusCode).toBe(201);
    expect((await post(harness, harness.streamIds.s2 as string, 'p720')).statusCode).toBe(429);
    expect((await slow).statusCode).toBe(504);
    expect(sessionDirs(harness)).toHaveLength(1);
  });
});
