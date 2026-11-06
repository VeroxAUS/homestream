import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProbeResult } from '../../src/playback/probe.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { bootHarness, generateSources, listFfmpegCommandLines, PROFILES, type Harness } from '../playback/harness.js';
import { hasNvenc } from '../hasNvenc.js';

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

interface EventRow {
  level: string;
  source: string;
  message: string;
  details_json: string;
}

let root: string;
let harness: Harness;

beforeAll(async () => {
  root = makeTempDir('prefetch');
  // The 201 waits for the first segment, so the encoder needs a real file even though the probe is stubbed.
  const sources = await generateSources(path.join(root, 'sources'));
  harness = await bootHarness({
    root,
    sources: { movie: { filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', path: sources.sdr } },
    probe: async () => PROBE,
    prefetch: { streamIdBudgetMs: 150 },
  });
}, 120_000);

afterAll(async () => {
  await harness?.close();
  clearSecrets();
  removeDir(root);
});

const body = (overrides: Record<string, unknown> = {}) => ({
  mediaType: 'movie',
  tmdbId: 278,
  device: PROFILES.chromecast4k,
  ...overrides,
});

function post(payload: unknown) {
  return harness.app.inject({ method: 'POST', url: '/api/prefetch', payload: payload as object });
}

function prefetchEvents(): EventRow[] {
  return harness.db
    .prepare("SELECT level, source, message, details_json FROM events WHERE source = 'prefetch' ORDER BY id")
    .all() as unknown as EventRow[];
}

describe.skipIf(!hasNvenc())('POST /api/prefetch', () => {
  it('answers 202 with the recommended stream id and warms the proxy and the probe once', async () => {
    const listed = (await harness.app.inject('/api/streams/movie/278')).json() as { recommendedId: string };
    const gatewayCalls = harness.stub.paths.length;

    const res = await post(body());
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ streamId: listed.recommendedId });

    await harness.app.ctx.prefetch.idle();
    expect(harness.probeCalls).toHaveLength(1);
    expect(harness.probeCalls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/src\/[\w-]+$/);
    expect(harness.resolveCalls).toHaveLength(1);
    expect(harness.stub.paths.length).toBe(gatewayCalls);
    expect(harness.app.ctx.sourceProxy.stats().sources).toBe(1);

    const events = prefetchEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: 'info', source: 'prefetch' });
    expect(JSON.parse(events[0]?.details_json ?? '{}')).toMatchObject({
      mediaKey: 'movie:278',
      deviceKind: 'tv',
      merged: false,
    });
  });

  it('merges a duplicate request into the running or finished warm-up', async () => {
    const before = prefetchEvents().length;
    const res = await post(body());
    expect(res.statusCode).toBe(202);
    expect((res.json() as { streamId: string | null }).streamId).toEqual(expect.any(String));
    await harness.app.ctx.prefetch.idle();

    expect(harness.probeCalls).toHaveLength(1);
    expect(harness.resolveCalls).toHaveLength(1);
    const events = prefetchEvents();
    expect(events).toHaveLength(before + 1);
    expect(events.at(-1)?.message).toContain('merged');
    expect(JSON.parse(events.at(-1)?.details_json ?? '{}')).toMatchObject({ merged: true });
  });

  it('lets the following auto session reuse the warm source and probe', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { mediaType: 'movie', tmdbId: 278, streamId: 'auto', device: PROFILES.chromecast4k },
    });
    expect(res.statusCode).toBe(201);
    const session = res.json() as { sessionId: string };
    expect(harness.probeCalls).toHaveLength(1);
    expect(harness.resolveCalls).toHaveLength(1);

    const lines = await listFfmpegCommandLines();
    for (const line of lines.filter((l) => l.includes(harness.transcodeDir))) {
      expect(line).not.toContain('cdn.example.test');
      expect(line).toMatch(/http:\/\/127\.0\.0\.1:\d+\/src\//);
    }
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${session.sessionId}` });
  });

  it('keeps URLs and tokens out of events and the response', async () => {
    const res = await post(body());
    const dump = JSON.stringify([res.json(), prefetchEvents()]);
    expect(dump).not.toMatch(/https?:\/\//);
    expect(dump).not.toContain('token0');
  });

  it.each([
    ['missing device', () => body({ device: undefined })],
    ['unknown media type', () => body({ mediaType: 'music' })],
    ['tv without season and episode', () => body({ mediaType: 'tv', tmdbId: 1396 })],
    ['non-numeric tmdbId', () => body({ tmdbId: 'abc' })],
  ])('rejects %s with 400', async (_name, make) => {
    const res = await post(make());
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'invalid_request' });
  });

  it('answers 202 with a null stream id for an unknown title and logs the failure as a warning', async () => {
    const res = await post(body({ tmdbId: 999_999_999 }));
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ streamId: null });
    await harness.app.ctx.prefetch.idle();
    const warn = prefetchEvents().filter((e) => e.level === 'warn');
    expect(warn.length).toBeGreaterThan(0);
    expect(JSON.stringify(warn)).not.toMatch(/https?:\/\//);
  });

  it('answers 202 with a null stream id when the stream list is not cached yet, then warms in the background', async () => {
    harness.stub.setDelay(4000);
    const started = Date.now();
    const res = await post(body({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 1, device: PROFILES.p720 }));
    expect(Date.now() - started).toBeLessThan(3000);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ streamId: null });
    harness.stub.setDelay(0);
    await harness.app.ctx.prefetch.idle();
    expect(harness.stub.paths.some((p) => p.includes('tt0903747'))).toBe(true);
    expect(harness.probeCalls).toHaveLength(1);
    expect(prefetchEvents().some((e) => e.level === 'warn' && e.message.includes('1396'))).toBe(false);
  });

  it('survives a failing gateway: 202, a warning event, nothing thrown', async () => {
    harness.stub.setRespond(() => ({ status: 500, raw: 'boom' }));
    const res = await post(body({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 2, device: PROFILES.emulator }));
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ streamId: null });
    await harness.app.ctx.prefetch.idle();
    expect(prefetchEvents().some((e) => e.level === 'warn')).toBe(true);
  });
});
