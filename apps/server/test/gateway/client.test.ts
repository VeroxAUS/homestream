import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GatewayClient, parseGatewayResponse } from '../../src/gateway/client.js';
import { RateLimiter } from '../../src/gateway/rateLimiter.js';
import { openDatabase, type Db } from '../../src/db/index.js';
import { createSilentLogger } from '../../src/logger.js';
import { AppError } from '../../src/errors.js';
import { makeTempDir, removeDir, testConfig } from '../helpers.js';
import { maxArrivalsInWindow, startStubGateway, stubStream, type StubGateway } from './stubGateway.js';

let stub: StubGateway;
let db: Db;
let dirs: string[] = [];
let clients: GatewayClient[] = [];

function tempDir(): string {
  const dir = makeTempDir('gateway');
  dirs.push(dir);
  return dir;
}

function makeClient(
  options: { limiter?: RateLimiter; timeoutMs?: number; now?: () => number; manifestUrl?: string } = {},
): GatewayClient {
  const config = testConfig(tempDir(), { GATEWAY_MANIFEST_URL: options.manifestUrl ?? stub.manifestUrl });
  const client = new GatewayClient({
    config,
    db,
    logger: createSilentLogger(),
    limiter: options.limiter ?? new RateLimiter({ maxRequests: 5, windowMs: 200, marginMs: 10 }),
    timeoutMs: options.timeoutMs,
    now: options.now,
  });
  clients.push(client);
  return client;
}

const oneStream = () => ({ streams: [stubStream(1, 'Movie.2020.1080p.WEB-DL.x264.mkv', { cached: true })] });

beforeEach(async () => {
  stub = await startStubGateway(() => ({ body: oneStream() }));
  db = openDatabase(':memory:');
});
afterEach(async () => {
  for (const client of clients) client.close();
  clients = [];
  await stub.close();
  db.close();
  for (const dir of dirs) removeDir(dir);
  dirs = [];
});

describe('GatewayClient', () => {
  it('requests the Stremio movie and series paths and parses the streams', async () => {
    const client = makeClient();
    const movie = await client.lookup({ type: 'movie', imdbId: 'tt0111161' });
    await client.lookup({ type: 'tv', imdbId: 'tt0903747', season: 1, episode: 2 });
    expect(stub.paths).toEqual(['/stream/movie/tt0111161.json', '/stream/series/tt0903747:1:2.json']);
    expect(movie).toHaveLength(1);
    expect(movie[0]).toMatchObject({ filename: 'Movie.2020.1080p.WEB-DL.x264.mkv', videoSize: 1_000_000_001 });
    expect(movie[0]?.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('de-duplicates concurrent identical lookups into one gateway request', async () => {
    stub.setDelay(300);
    const client = makeClient();
    const query = { type: 'movie', imdbId: 'tt15239678' } as const;
    const results = await Promise.all([client.lookup(query), client.lookup(query), client.lookup(query)]);
    expect(stub.paths).toEqual(['/stream/movie/tt15239678.json']);
    expect(results[1]).toEqual(results[0]);
  });

  it('serves repeat lookups from the SQLite cache and stores a 60 minute expiry', async () => {
    let clock = 5_000_000;
    const client = makeClient({ now: () => clock });
    const query = { type: 'movie', imdbId: 'tt0111161' } as const;
    await client.lookup(query);

    const started = performance.now();
    await client.lookup(query);
    expect(performance.now() - started).toBeLessThan(50);
    expect(stub.paths).toHaveLength(1);

    const row = db.prepare('SELECT key, expires_at FROM gateway_cache').get() as { key: string; expires_at: number };
    expect(row.key).toBe('movie:tt0111161');
    expect(row.expires_at).toBe(clock + 60 * 60 * 1000);

    clock += 60 * 60 * 1000 + 1;
    await client.lookup(query);
    expect(stub.paths).toHaveLength(2);
  });

  it('caches empty results for a shorter time', async () => {
    stub.setRespond(() => ({ body: { streams: [] } }));
    const clock = 1_000;
    const client = makeClient({ now: () => clock });
    expect(await client.lookup({ type: 'movie', imdbId: 'tt0000001' })).toEqual([]);
    const row = db.prepare('SELECT expires_at FROM gateway_cache').get() as { expires_at: number };
    expect(row.expires_at - clock).toBe(5 * 60 * 1000);
  });

  it('queues a burst of distinct lookups: all succeed, at most 5 arrive per window', async () => {
    stub.setDelay(20);
    const windowMs = 300;
    const client = makeClient({ limiter: new RateLimiter({ maxRequests: 5, windowMs, marginMs: 20 }) });
    const lookups = Array.from({ length: 12 }, (_, i) =>
      client.lookup({ type: 'tv', imdbId: 'tt0903747', season: Math.floor(i / 7) + 1, episode: (i % 7) + 1 }),
    );
    const results = await Promise.all(lookups);
    expect(results).toHaveLength(12);
    expect(stub.paths).toHaveLength(12);
    expect(maxArrivalsInWindow(stub.arrivals, windowMs)).toBeLessThanOrEqual(5);
  });

  it('turns a request timeout into a 502 with a hint', async () => {
    stub.setDelay(600);
    const client = makeClient({ timeoutMs: 150 });
    const error = (await client.lookup({ type: 'movie', imdbId: 'tt0111161' }).catch((e: unknown) => e)) as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(502);
    expect(error.code).toBe('gateway_unavailable');
    expect(error.message).toMatch(/no answer within/);
    expect(error.hint).toBeTruthy();
    expect(client.stats.errors).toBe(1);
  });

  it('turns HTTP errors and invalid JSON into 502 and does not cache failures', async () => {
    const client = makeClient();
    stub.setRespond(() => ({ status: 500, body: {} }));
    await expect(client.lookup({ type: 'movie', imdbId: 'tt0111161' })).rejects.toMatchObject({ statusCode: 502 });
    stub.setRespond(() => ({ raw: '<html>nope</html>' }));
    await expect(client.lookup({ type: 'movie', imdbId: 'tt0111161' })).rejects.toMatchObject({ statusCode: 502 });
    stub.setRespond(() => ({ status: 404, body: {} }));
    await expect(client.lookup({ type: 'movie', imdbId: 'tt0111161' })).rejects.toMatchObject({
      statusCode: 502,
      hint: expect.stringContaining('GATEWAY_MANIFEST_URL'),
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM gateway_cache').get()).toEqual({ n: 0 });
    stub.setRespond(() => ({ body: oneStream() }));
    expect(await client.lookup({ type: 'movie', imdbId: 'tt0111161' })).toHaveLength(1);
  });

  it('reports an unreachable gateway as 502', async () => {
    const dead = await startStubGateway(() => ({}));
    const url = dead.manifestUrl;
    await dead.close();
    const client = makeClient({ manifestUrl: url });
    await expect(client.lookup({ type: 'movie', imdbId: 'tt0111161' })).rejects.toMatchObject({
      statusCode: 502,
      code: 'gateway_unavailable',
    });
  });

  it('reports a missing gateway configuration as 503 config_missing', async () => {
    const config = testConfig(tempDir(), {}, 'TMDB_READ_TOKEN=tmdb-test-token-123456\n');
    const client = new GatewayClient({ config, db, logger: createSilentLogger() });
    clients.push(client);
    await expect(client.lookup({ type: 'movie', imdbId: 'tt0111161' })).rejects.toMatchObject({
      statusCode: 503,
      code: 'config_missing',
    });
  });
});

describe('parseGatewayResponse', () => {
  it('drops entries without an http(s) url, de-duplicates by url and falls back to the url file name', () => {
    const parsed = parseGatewayResponse({
      streams: [
        { name: 'info only', description: 'no url' },
        { name: 'x', url: 'ftp://nope/file.mkv' },
        {
          name: 'a',
          url: 'https://cdn.example.test/p/My%20Movie%202020%201080p.mkv',
          behaviorHints: { videoSize: 'abc' },
        },
        { name: 'dup', url: 'https://cdn.example.test/p/My%20Movie%202020%201080p.mkv' },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ filename: 'My Movie 2020 1080p.mkv', videoSize: 0, name: 'a' });
  });

  it('keeps the cached flag, info hash, file index and type from streamData, and falls back to its size', () => {
    const hash = 'AbCdEf0123456789AbCdEf0123456789AbCdEf01';
    const parsed = parseGatewayResponse({
      streams: [
        {
          name: 'a',
          url: 'https://cdn.example.test/p/one.mkv',
          streamData: {
            type: 'debrid',
            service: { id: 'torbox', cached: false },
            torrent: { infoHash: hash, fileIdx: 3 },
            size: 1234,
          },
        },
        {
          name: 'b',
          url: 'https://cdn.example.test/p/two.mkv',
          streamData: { service: { cached: 'yes' }, torrent: { infoHash: 'short' } },
        },
        {
          name: 'c',
          url: 'https://cdn.example.test/p/three.mkv',
          behaviorHints: { videoSize: 99 },
          streamData: { size: 5 },
        },
      ],
    });
    expect(parsed[0]).toMatchObject({
      cached: false,
      infoHash: hash.toLowerCase(),
      fileIdx: 3,
      kind: 'debrid',
      videoSize: 1234,
    });
    expect(parsed[1]?.cached).toBeUndefined();
    expect(parsed[1]?.infoHash).toBeUndefined();
    expect(parsed[2]?.videoSize).toBe(99);
  });

  it('rejects a body without a streams array', () => {
    expect(() => parseGatewayResponse({ error: 'x' })).toThrow();
    expect(() => parseGatewayResponse(null)).toThrow();
  });
});
