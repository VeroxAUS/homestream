// @no-ffmpeg: fake encoders and a stubbed probe; nothing here starts ffmpeg or touches the GPU.
import path from 'node:path';
import type { ActivityResponse } from '@homestream/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_SESSIONS } from '../../src/playback/manager.js';
import type { ProbeResult } from '../../src/playback/probe.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { FakeEncoders } from './fakeEncoder.js';
import { bootHarness, PROFILES, startSession, type Harness, type HarnessOptions, type ProfileName } from './harness.js';

const PROBE: ProbeResult = {
  durationSec: 120,
  video: { index: 0, codec: 'h264', profile: 'High', width: 1920, height: 1080, pixFmt: 'yuv420p', fps: 24, hdr: 'sdr', dolbyVisionProfile: null },
  audio: [{ index: 1, codec: 'ac3', channels: 6, language: 'eng', title: '', default: true }],
  subtitles: [],
};

let root: string;
const harnesses: Harness[] = [];

beforeAll(() => {
  root = makeTempDir('session-limit');
});

afterAll(async () => {
  for (const harness of harnesses) await harness.close();
  clearSecrets();
  removeDir(root);
});

async function boot(playback: HarnessOptions['playback'] = {}): Promise<{ harness: Harness; encoders: FakeEncoders }> {
  const encoders = new FakeEncoders();
  const harness = await bootHarness({
    root: makeTempDir('inst'),
    sources: { movie: { filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', path: path.join(root, 'does-not-exist.mkv') } },
    probe: async () => PROBE,
    playback: { createEncoder: encoders.create, ...playback },
  });
  harnesses.push(harness);
  return { harness, encoders };
}

const start = (harness: Harness, profile: ProfileName) => startSession(harness, 'movie', profile);

async function activityCount(harness: Harness): Promise<number> {
  return ((await harness.app.inject('/api/activity')).json() as ActivityResponse).sessions.length;
}

async function waitFor(done: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function expectRefusedThird(harness: Harness, encoders: FakeEncoders): Promise<void> {
  const encodersBefore = encoders.started;
  const probesBefore = harness.probeCalls.length;
  const resolvesBefore = harness.resolveCalls.length;
  const third = await start(harness, 'p720');
  expect(third.status).toBe(429);
  expect(third.body).toMatchObject({
    error: {
      code: 'too_many_sessions',
      message: 'Two streams are already playing. Stop one to start another.',
      hint: expect.stringMatching(/stop/i),
    },
  });
  expect(encoders.started).toBe(encodersBefore);
  expect(harness.probeCalls.length).toBe(probesBefore);
  expect(harness.resolveCalls.length).toBe(resolvesBefore);
}

describe('concurrent session limit of two', () => {
  it('defaults to two', () => {
    expect(MAX_SESSIONS).toBe(2);
  });

  it('starts two sessions, refuses the third with 429 and no encoder, and accepts one again after DELETE', async () => {
    const { harness, encoders } = await boot();
    const first = await start(harness, 'chromecast4k');
    const second = await start(harness, 'desktop');
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(encoders.started).toBe(2);

    await expectRefusedThird(harness, encoders);
    expect(await activityCount(harness)).toBe(2);
    expect(harness.app.ctx.playback.list()).toHaveLength(2);

    const del = await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${first.body.sessionId}` });
    expect(del.statusCode).toBeLessThan(300);
    const again = await start(harness, 'emulator');
    expect(again.status).toBe(201);
    expect(encoders.started).toBe(3);
    await expectRefusedThird(harness, encoders);
  });

  it('counts starts that are still preparing', async () => {
    const { harness, encoders } = await boot();
    const results = await Promise.all((['chromecast4k', 'desktop', 'emulator'] as const).map((profile) => start(harness, profile)));
    expect(results.map((result) => result.status).sort()).toEqual([201, 201, 429]);
    expect(encoders.started).toBe(2);
    expect(await activityCount(harness)).toBe(2);
  });

  it('releases the slot when a start fails before a session exists', async () => {
    const { harness, encoders } = await boot();
    for (let i = 0; i < 4; i += 1) {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { mediaType: 'movie', tmdbId: 278, streamId: '0000000000000000', device: PROFILES.desktop },
      });
      expect(res.statusCode).toBe(404);
    }
    expect([(await start(harness, 'desktop')).status, (await start(harness, 'emulator')).status]).toEqual([201, 201]);
    expect(encoders.started).toBe(2);
  });

  it('releases the slot of a session stopped for idleness', async () => {
    const { harness, encoders } = await boot({ idleTimeoutMs: 300, monitorTickMs: 100 });
    await start(harness, 'chromecast4k');
    await start(harness, 'desktop');
    await waitFor(async () => (await activityCount(harness)) === 0);

    const results = [await start(harness, 'emulator'), await start(harness, 'p720')];
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    expect(encoders.started).toBe(4);
  });

  it('releases the slot of a start whose encoder failed before the first segment', async () => {
    const { harness, encoders } = await boot();
    encoders.mode = 'fail';
    const broken = await start(harness, 'chromecast4k');
    // One automatic retry, then the start fails and nothing is left of it.
    expect(broken.status).toBe(502);
    expect(broken.body).toMatchObject({ error: { code: 'encoder_failed' } });
    expect(encoders.started).toBe(2);
    expect(await activityCount(harness)).toBe(0);
    expect(harness.app.ctx.playback.list()).toEqual([]);

    encoders.mode = 'run';
    const results = [await start(harness, 'desktop'), await start(harness, 'emulator')];
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    await expectRefusedThird(harness, encoders);
  });

  it('releases the slot of a session whose encoder failed after the first segment, while the failed record still exists', async () => {
    const { harness, encoders } = await boot();
    const broken = await start(harness, 'chromecast4k');
    expect(broken.status).toBe(201);
    encoders.mode = 'fail';
    encoders.handles[0]?.crash();
    await waitFor(async () => (await harness.app.inject(`/api/sessions/${broken.body.sessionId}`)).json().state === 'error');
    // One automatic retry, then the session ends in error.
    expect(encoders.started).toBe(2);
    expect(await activityCount(harness)).toBe(0);

    encoders.mode = 'run';
    const results = [await start(harness, 'desktop'), await start(harness, 'emulator')];
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    await expectRefusedThird(harness, encoders);

    expect((await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${broken.body.sessionId}` })).statusCode).toBeLessThan(300);
    await expectRefusedThird(harness, encoders);
  });

  it('keeps the limit when a running session is stopped twice', async () => {
    const { harness, encoders } = await boot();
    const first = await start(harness, 'chromecast4k');
    await start(harness, 'desktop');
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${first.body.sessionId}` });
    expect((await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${first.body.sessionId}` })).statusCode).toBe(404);
    expect((await start(harness, 'emulator')).status).toBe(201);
    await expectRefusedThird(harness, encoders);
  });
});
