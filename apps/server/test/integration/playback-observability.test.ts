// @no-ffmpeg: fake encoders and a stubbed probe; nothing here starts ffmpeg or touches the GPU.
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProbeResult } from '../../src/playback/probe.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { FakeEncoders } from '../playback/fakeEncoder.js';
import { bootHarness, startSession, type Harness } from '../playback/harness.js';
import { parseEnvelope, startTelemetryStub, type LooseJson, type TelemetryStub } from '../telemetry/stubServer.js';

const PROBE: ProbeResult = {
  durationSec: 120,
  video: {
    index: 0,
    codec: 'h264',
    profile: 'High',
    width: 1920,
    height: 1080,
    pixFmt: 'yuv420p',
    fps: 24,
    hdr: 'sdr',
    dolbyVisionProfile: null,
  },
  audio: [{ index: 1, codec: 'ac3', channels: 6, language: 'eng', title: '', default: true }],
  subtitles: [],
};

let root: string;
let stub: TelemetryStub;

beforeAll(async () => {
  root = makeTempDir('playback-observability');
  stub = await startTelemetryStub();
});
afterAll(async () => {
  await stub.close();
  clearSecrets();
  removeDir(root);
});

async function boot(): Promise<{ harness: Harness; encoders: FakeEncoders }> {
  stub.requests.length = 0;
  const encoders = new FakeEncoders();
  const harness = await bootHarness({
    root: makeTempDir('inst'),
    sources: { movie: { filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', path: path.join(root, 'none.mkv') } },
    probe: async () => PROBE,
    playback: { createEncoder: encoders.create },
    env: {
      SENTRY_DSN_SERVER: stub.dsn,
      POSTHOG_API_KEY: 'phc_stubkey0000',
      POSTHOG_HOST: stub.origin,
    },
  });
  return { harness, encoders };
}

async function metric(harness: Harness, name: string, labels: Record<string, string> = {}): Promise<number> {
  const text = (await harness.app.inject('/metrics')).body;
  const wanted = Object.entries(labels).map(([key, value]) => `${key}="${value}"`);
  const line = text
    .split('\n')
    .find((entry) => entry.startsWith(name) && !entry.startsWith('#') && wanted.every((part) => entry.includes(part)));
  return line ? Number(line.slice(line.lastIndexOf(' ') + 1)) : 0;
}

async function waitFor(done: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function postHogEvents(): Array<LooseJson> {
  return stub.requests
    .filter((request) => request.path.endsWith('/batch/'))
    .flatMap((request) => JSON.parse(request.body).batch as Array<LooseJson>);
}

describe('session metrics and events', () => {
  it('counts a started and a stopped session and sends playback_started and playback_ended', async () => {
    const { harness } = await boot();
    const started = await startSession(harness, 'movie', 'chromecast4k');
    expect(started.status).toBe(201);
    expect(await metric(harness, 'homestream_sessions_started_total')).toBe(1);
    expect(await metric(harness, 'homestream_sessions_active')).toBe(1);

    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${started.body.sessionId}` });
    expect(await metric(harness, 'homestream_sessions_active')).toBe(0);
    expect(await metric(harness, 'homestream_sessions_started_total')).toBe(1);
    await harness.close();

    const events = postHogEvents();
    const begun = events.find((event) => event.event === 'playback_started');
    expect(begun?.properties).toMatchObject({
      mediaType: 'movie',
      deviceKind: 'tv',
      videoCodec: 'hevc',
      resolution: '1080p',
      hdr: false,
    });
    expect(typeof begun?.properties.startupMs).toBe('number');
    expect(typeof begun?.properties.title).toBe('string');
    const ended = events.find((event) => event.event === 'playback_ended');
    expect(ended?.properties).toMatchObject({ reason: 'stopped', mediaType: 'movie' });
    expect(JSON.stringify(events)).not.toMatch(/Movie\.1994|tb-cdn|127\.0\.0\.1:\d+\/|\.mkv/);
  });

  it('counts a failed start by stage and code, and the encoder retry as a restart', async () => {
    const { harness, encoders } = await boot();
    encoders.mode = 'fail';
    const broken = await startSession(harness, 'movie', 'desktop');
    expect(broken.status).toBe(502);
    expect(await metric(harness, 'homestream_sessions_failed_total', { stage: 'start', code: 'encoder_failed' })).toBe(
      1,
    );
    expect(await metric(harness, 'homestream_encoder_restarts_total', { reason: 'retry' })).toBeGreaterThanOrEqual(1);
    expect(await metric(harness, 'homestream_sessions_started_total')).toBe(0);
    await harness.close();

    const failed = postHogEvents().find((event) => event.event === 'playback_failed');
    expect(failed?.properties).toMatchObject({ stage: 'start', errorCode: 'encoder_failed', deviceKind: 'desktop' });
    expect(stub.requests.filter((request) => request.path.includes('/envelope/'))).toEqual([]);
  });

  it('reports an encoder that fails while playing as a metric, an event and a tagged Sentry error', async () => {
    const { harness, encoders } = await boot();
    const session = await startSession(harness, 'movie', 'chromecast4k');
    expect(session.status).toBe(201);
    encoders.mode = 'fail';
    encoders.handles[0]?.crash();
    await waitFor(
      async () => (await harness.app.inject(`/api/sessions/${session.body.sessionId}`)).json().state === 'error',
    );
    expect(
      await metric(harness, 'homestream_sessions_failed_total', { stage: 'running', code: 'encoder_failed' }),
    ).toBe(1);
    expect(await metric(harness, 'homestream_sessions_active')).toBe(0);
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${session.body.sessionId}` });
    await harness.close();

    const items = stub.requests
      .filter((request) => request.path.includes('/envelope/'))
      .flatMap((request) => parseEnvelope(request.body));
    const event = items.find((item) => item.header.type === 'event')?.payload as LooseJson;
    expect(event.tags).toMatchObject({ 'device.kind': 'tv', 'media.type': 'movie', error_code: 'encoder_failed' });
    expect(postHogEvents().map((entry) => entry.event)).toContain('playback_failed');
  });

  it('counts a seek restart', async () => {
    const { harness } = await boot();
    const session = await startSession(harness, 'movie', 'desktop');
    expect(session.status).toBe(201);
    await harness.app.inject(`/hls/${session.body.sessionId}/seg-20.ts`).catch(() => undefined);
    await waitFor(async () => (await metric(harness, 'homestream_encoder_restarts_total', { reason: 'seek' })) >= 1);
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${session.body.sessionId}` });
    await harness.close();
  });
});
