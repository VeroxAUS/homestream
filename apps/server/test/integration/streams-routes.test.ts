import type { CapabilityProfile, StreamOption, StreamsResponse } from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { openDatabase, type Db } from '../../src/db/index.js';
import { GatewayClient } from '../../src/gateway/client.js';
import { RateLimiter } from '../../src/gateway/rateLimiter.js';
import { createSilentLogger } from '../../src/logger.js';
import { clearSecrets } from '../../src/redact.js';
import { TmdbService } from '../../src/tmdb/service.js';
import { makeTempDir, removeDir, testConfig } from '../helpers.js';
import {
  startStubGateway,
  stubStream,
  type StubGateway,
  type StubResponse,
  type StubStream,
} from '../gateway/stubGateway.js';
import { makeFakeTmdb } from '../tmdb/fixtures.js';

const SHAWSHANK_FILES: Array<[string, boolean]> = [
  ['The.Shawshank.Redemption.1994.1080p.WEB-DL.DDP5.1.x264-GRP.mkv', true],
  ['The.Shawshank.Redemption.1994.2160p.UHD.BluRay.REMUX.DV.HEVC.DTS-HD.MA.5.1-GRP.mkv', true],
  ['The.Shawshank.Redemption.1994.720p.BluRay.x264-GRP.mkv', true],
  ['The.Shawshank.Redemption.1994.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-GRP.mkv', true],
  ['The.Shawshank.Redemption.1994.480p.DVDRip.XviD-GRP.avi', true],
  ['The.Shawshank.Redemption.1994.2160p.WEB-DL.HDR.H.265-GRP.mkv', false],
  ['The.Shawshank.Redemption.1994.1080p.BluRay.x264-GRP.mkv', false],
];

function streamsFor(files: Array<[string, boolean]>): StubStream[] {
  return files.map(([name, cached], i) => stubStream(i, name, { cached }));
}

const PROFILES: Record<string, Partial<CapabilityProfile>> = {
  chromecast4k: { kind: 'tv', maxWidth: 3840, maxHeight: 2160, hevc: true, hevcMain10: true, hdr10: true },
  emulator: { kind: 'tv', maxWidth: 1920, maxHeight: 1080, hevc: true },
  desktop: { kind: 'desktop', maxWidth: 3840, maxHeight: 2160 },
  p720: { kind: 'web', maxWidth: 1280, maxHeight: 720 },
  p480: { kind: 'web', maxWidth: 854, maxHeight: 480 },
};

let stub: StubGateway;
let app: FastifyInstance;
let db: Db;
let gateway: GatewayClient;
let clock: number;
let dirs: string[] = [];

async function boot(
  respond: (path: string) => StubResponse = () => ({ body: { streams: streamsFor(SHAWSHANK_FILES) } }),
): Promise<void> {
  stub = await startStubGateway(respond);
  const dir = makeTempDir('streams');
  dirs.push(dir);
  const config = testConfig(dir, { GATEWAY_MANIFEST_URL: stub.manifestUrl });
  db = openDatabase(config.dataDir);
  const logger = createSilentLogger();
  const fake = makeFakeTmdb();
  const tmdb = new TmdbService({ config, db, logger, fetch: fake.fetch });
  gateway = new GatewayClient({
    config,
    db,
    logger,
    limiter: new RateLimiter({ maxRequests: 5, windowMs: 100, marginMs: 5 }),
    now: () => clock,
    timeoutMs: 1_000,
  });
  app = await buildApp(config, { logger, db, tmdb, gateway });
  await app.ready();
}

async function registerDevice(name: string): Promise<string> {
  const profile = {
    deviceId: `dev-${name}`,
    deviceName: name,
    kind: 'tv',
    maxWidth: 1920,
    maxHeight: 1080,
    h264: true,
    hevc: false,
    hevcMain10: false,
    hdr10: false,
    maxAudioChannels: 2,
    ...PROFILES[name],
  };
  const res = await app.inject({ method: 'POST', url: '/api/devices', payload: profile });
  expect(res.statusCode).toBe(200);
  return profile.deviceId;
}

async function getStreams(url: string): Promise<{ status: number; body: StreamsResponse & Record<string, unknown> }> {
  const res = await app.inject(url);
  return { status: res.statusCode, body: res.json() };
}

beforeEach(() => {
  clock = 10_000_000;
});
afterEach(async () => {
  await app.close();
  db.close();
  await stub.close();
  for (const dir of dirs) removeDir(dir);
  dirs = [];
});
afterAll(() => clearSecrets());

describe('GET /api/streams/movie/:tmdbId', () => {
  beforeEach(() => boot());

  it('returns ranked, parsed streams and a recommendedId, visible streams being cached only', async () => {
    const { status, body } = await getStreams('/api/streams/movie/278');
    expect(status).toBe(200);
    expect(body.reason).toBeUndefined();
    expect(stub.paths).toEqual(['/stream/movie/tt0111161.json']);

    expect(body.streams).toHaveLength(5);
    expect(body.streams.every((s) => s.cached)).toBe(true);
    expect(body.streams.map((s) => s.resolution)).toEqual(['2160p', '1080p', '1080p', '720p', '480p']);
    expect(body.streams.map((s) => s.source)).toEqual(['Remux', 'WEB-DL', 'Remux', 'BluRay', 'DVD']);
    expect(body.streams[0]).toMatchObject({ videoCodec: 'hevc', hdr: 'dv', audio: 'DTS-HD MA 5.1' });
    expect(body.recommendedId).toBe(body.streams[0]?.id);
    for (const s of body.streams) {
      expect(s.id).toMatch(/^[0-9a-f]{16}$/);
      expect(s.sizeBytes).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it('never exposes raw urls, hosts or secrets', async () => {
    const res = await app.inject('/api/streams/movie/278');
    const text = res.body;
    expect(text).not.toMatch(/"url"/);
    expect(text).not.toMatch(/https?:\/\//i);
    expect(text).not.toContain('cdn.example.test');
    expect(text).not.toContain('stubsecret');
    expect(text).not.toContain('token');
  });

  it('serves the repeat request from the gateway cache without another gateway call', async () => {
    await app.inject('/api/streams/movie/278');
    const started = performance.now();
    const again = await app.inject('/api/streams/movie/278');
    expect(again.statusCode).toBe(200);
    expect(performance.now() - started).toBeLessThan(200);
    expect(stub.paths).toHaveLength(1);
  });

  it('rejects invalid ids and deviceId with 400', async () => {
    expect((await getStreams('/api/streams/movie/abc')).status).toBe(400);
    expect((await getStreams('/api/streams/movie/0')).status).toBe(400);
    expect((await getStreams('/api/streams/movie/278?deviceId=')).status).toBe(400);
    expect(stub.paths).toHaveLength(0);
  });

  it('returns 404 for a movie TMDB does not know, without calling the gateway', async () => {
    const { status, body } = await getStreams('/api/streams/movie/999999');
    expect(status).toBe(404);
    expect((body as unknown as { error: { code: string } }).error.code).toBe('not_found');
    expect(stub.paths).toHaveLength(0);
  });
});

describe('recommendedId and the device profile', () => {
  beforeEach(() => boot());

  async function recommended(deviceId?: string): Promise<StreamOption> {
    const { body } = await getStreams(`/api/streams/movie/278${deviceId ? `?deviceId=${deviceId}` : ''}`);
    const found = body.streams.find((s) => s.id === body.recommendedId);
    expect(found).toBeDefined();
    return found as StreamOption;
  }

  it('honors the maximum resolution of each registered device', async () => {
    const ids = { chromecast4k: '', emulator: '', desktop: '', p720: '', p480: '' };
    for (const name of Object.keys(ids) as Array<keyof typeof ids>) ids[name] = await registerDevice(name);

    expect((await recommended(ids.chromecast4k)).resolution).toBe('2160p');
    expect((await recommended(ids.desktop)).resolution).toBe('2160p');
    expect((await recommended(ids.emulator)).resolution).toBe('1080p');
    expect((await recommended(ids.p720)).resolution).toBe('720p');
    expect((await recommended(ids.p480)).resolution).toBe('480p');
  });

  it('uses the first ranked stream with no deviceId or an unknown one', async () => {
    expect((await recommended()).resolution).toBe('2160p');
    expect((await recommended('never-registered')).resolution).toBe('2160p');
  });
});

describe('recommendedId when nothing fits', () => {
  it('picks the first-ranked stream with the lowest resolution', async () => {
    await boot(() => ({
      body: {
        streams: streamsFor([
          ['A.2024.2160p.BluRay.REMUX.HEVC-GRP.mkv', true],
          ['A.2024.1080p.WEB-DL.x264-GRP.mkv', true],
          ['A.2024.1080p.BluRay.x264-GRP.mkv', true],
        ]),
      },
    }));
    const deviceId = await registerDevice('p480');
    const { body } = await getStreams(`/api/streams/movie/278?deviceId=${deviceId}`);
    const picked = body.streams.find((s) => s.id === body.recommendedId);
    expect(picked?.filename).toBe('A.2024.1080p.WEB-DL.x264-GRP.mkv');
  });
});

describe('uncached-only and empty gateway results', () => {
  it('returns uncached streams flagged when nothing is cached', async () => {
    await boot(() => ({
      body: {
        streams: streamsFor([
          ['B.2024.720p.WEB-DL.x264-GRP.mkv', false],
          ['B.2024.1080p.WEB-DL.x264-GRP.mkv', false],
        ]),
      },
    }));
    const { status, body } = await getStreams('/api/streams/movie/278');
    expect(status).toBe(200);
    expect(body.reason).toBeUndefined();
    expect(body.streams).toHaveLength(2);
    expect(body.streams.every((s) => s.cached === false)).toBe(true);
    expect(body.recommendedId).toBe(body.streams[0]?.id);
    expect(body.streams[0]?.resolution).toBe('1080p');
  });

  it('returns 200 with reason no_streams for an empty gateway list', async () => {
    await boot(() => ({ body: { streams: [] } }));
    const { status, body } = await getStreams('/api/streams/tv/1396/99/99');
    expect(status).toBe(200);
    expect(body).toEqual({ streams: [], recommendedId: null, reason: 'no_streams' });
    expect(stub.paths).toEqual(['/stream/series/tt0903747:99:99.json']);
  });

  it('drops season packs of other seasons the gateway adds to a missing episode lookup', async () => {
    await boot(() => ({
      body: {
        streams: streamsFor([
          ['Breaking Bad S04-720 Movies-daily.com', false],
          ['Breaking Bad S01-720 Movies-daily com', false],
        ]),
      },
    }));
    const { status, body } = await getStreams('/api/streams/tv/1396/99/99');
    expect(status).toBe(200);
    expect(body).toEqual({ streams: [], recommendedId: null, reason: 'no_streams' });
  });

  it('serves episodes through the series endpoint', async () => {
    await boot();
    const { status, body } = await getStreams('/api/streams/tv/1396/1/1');
    expect(status).toBe(200);
    expect(body.streams.length).toBeGreaterThan(0);
    expect(stub.paths).toEqual(['/stream/series/tt0903747:1:1.json']);
    expect((await getStreams('/api/streams/tv/1396/1/0')).status).toBe(400);
  });
});

describe('gateway failures', () => {
  it('returns 502 with a hint when the gateway answers with an error', async () => {
    await boot(() => ({ status: 500, body: {} }));
    const res = await app.inject('/api/streams/movie/278');
    expect(res.statusCode).toBe(502);
    const error = res.json().error;
    expect(error.code).toBe('gateway_unavailable');
    expect(error.hint).toBeTruthy();
    expect(res.body).not.toContain('stubsecret');
  });

  it('returns 502 when the gateway is unreachable', async () => {
    await boot();
    await stub.close();
    const res = await app.inject('/api/streams/movie/278');
    expect(res.statusCode).toBe(502);
    expect(res.json().error.hint).toBeTruthy();
    stub = await startStubGateway(() => ({}));
  });

  it('returns 503 config_missing when GATEWAY_MANIFEST_URL is not configured', async () => {
    stub = await startStubGateway(() => ({}));
    const dir = makeTempDir('streams-nocfg');
    dirs.push(dir);
    const config = testConfig(dir, {}, 'TMDB_READ_TOKEN=tmdb-test-token-123456\n');
    db = openDatabase(config.dataDir);
    const logger = createSilentLogger();
    const tmdb = new TmdbService({ config, db, logger, fetch: makeFakeTmdb().fetch });
    app = await buildApp(config, { logger, db, tmdb });
    const res = await app.inject('/api/streams/movie/278');
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('config_missing');
    expect(res.json().error.hint).toContain('GATEWAY_MANIFEST_URL');
  });
});

describe('getStreamById', () => {
  beforeEach(() => boot());

  it('resolves a listed id to the raw url, and null for unknown ids', async () => {
    const { body } = await getStreams('/api/streams/movie/278');
    const first = body.streams[0] as StreamOption;
    const resolved = await app.ctx.streams.getStreamById(first.id);
    expect(resolved?.url).toMatch(/^https:\/\/cdn\.example\.test\/playback\/token\d+\//);
    expect(resolved?.stream.filename).toBe(first.filename);
    expect(await app.ctx.streams.getStreamById('0000000000000000')).toBeNull();
    expect(await app.ctx.streams.getStreamById('not-an-id')).toBeNull();
    expect(stub.paths).toHaveLength(1);
  });

  it('re-fetches the lookup when the cached list has expired', async () => {
    const { body } = await getStreams('/api/streams/movie/278');
    const id = (body.streams[0] as StreamOption).id;
    clock += 61 * 60 * 1000;
    const resolved = await app.ctx.streams.getStreamById(id);
    expect(resolved?.id).toBe(id);
    expect(stub.paths).toEqual(['/stream/movie/tt0111161.json', '/stream/movie/tt0111161.json']);
  });

  it('returns null when the refreshed list no longer offers the stream', async () => {
    const { body } = await getStreams('/api/streams/movie/278');
    const id = (body.streams[0] as StreamOption).id;
    stub.setRespond(() => ({ body: { streams: [] } }));
    clock += 61 * 60 * 1000;
    expect(await app.ctx.streams.getStreamById(id)).toBeNull();
  });
});
