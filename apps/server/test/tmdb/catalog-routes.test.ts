import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { openDatabase, type Db } from '../../src/db/index.js';
import { createSilentLogger } from '../../src/logger.js';
import { clearSecrets } from '../../src/redact.js';
import { TmdbService } from '../../src/tmdb/service.js';
import { makeTempDir, removeDir, testConfig } from '../helpers.js';
import { makeFakeTmdb, type FakeTmdb } from './fixtures.js';

let app: FastifyInstance;
let fake: FakeTmdb;
let clock = 1_000_000;
let dbs: Db[] = [];
let dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  dirs.push(dir);
  return dir;
}

function closeDbs(): void {
  for (const db of dbs) db.close();
  dbs = [];
}

async function boot(dir: string): Promise<FastifyInstance> {
  const config = testConfig(dir);
  const db = openDatabase(config.dataDir);
  dbs.push(db);
  const logger = createSilentLogger();
  const tmdb = new TmdbService({ config, db, logger, fetch: fake.fetch, now: () => clock });
  return buildApp(config, { logger, db, tmdb });
}

beforeEach(() => {
  fake = makeFakeTmdb();
  clock = 1_000_000;
});
afterEach(() => {
  closeDbs();
  for (const dir of dirs) removeDir(dir);
  dirs = [];
});
afterAll(() => clearSecrets());

describe('catalog routes with a fake TMDB', () => {
  beforeEach(async () => {
    app = await boot(tempDir('catalog-db'));
  });
  afterEach(async () => {
    await app.close();
  });
  it('GET /api/home returns the four TMDB rows plus an empty continueWatching', async () => {
    const res = await app.inject('/api/home');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.continueWatching).toEqual([]);
    for (const row of ['trendingMovies', 'popularMovies']) {
      expect(body[row]).toHaveLength(12);
      expect(body[row].every((item: { type: string }) => item.type === 'movie')).toBe(true);
    }
    for (const row of ['trendingShows', 'popularShows']) {
      expect(body[row].every((item: { type: string }) => item.type === 'tv')).toBe(true);
    }
    expect(body.trendingMovies[0].posterUrl).toBe('https://image.example.test/t/p/w342/poster1.jpg');
  });

  it('serves a repeated request from the cache', async () => {
    await app.inject('/api/movie/278');
    const before = fake.calls.length;
    const res = await app.inject('/api/movie/278');
    expect(res.statusCode).toBe(200);
    expect(fake.calls.length).toBe(before);
  });

  it('stores lists for 1h, details and configuration for 24h, search for 10min', async () => {
    await app.inject('/api/home');
    await app.inject('/api/movie/278');
    await app.inject('/api/search?q=Breaking%20Bad');
    const rows = app.ctx.db.prepare('SELECT key, expires_at FROM tmdb_cache').all() as {
      key: string;
      expires_at: number;
    }[];
    const ttl = (key: string) => rows.find((row) => row.key === key)!.expires_at - clock;
    expect(ttl('list:trending:movie')).toBe(3_600_000);
    expect(ttl('movie:278')).toBe(86_400_000);
    expect(ttl('configuration')).toBe(86_400_000);
    expect(ttl('search:breaking bad')).toBe(600_000);
  });

  it('refetches after the TTL expires', async () => {
    await app.inject('/api/search?q=hanks');
    const before = fake.calls.length;
    clock += 10 * 60_000 + 1;
    await app.inject('/api/search?q=hanks');
    expect(fake.calls.length).toBe(before + 1);
  });

  it('de-duplicates concurrent identical requests', async () => {
    await Promise.all([app.inject('/api/tv/1396'), app.inject('/api/tv/1396'), app.inject('/api/tv/1396')]);
    expect(fake.calls.filter((call) => call.startsWith('/3/tv/1396?'))).toHaveLength(1);
  });

  it('search drops people and treats the query case/space-insensitively for caching', async () => {
    const res = await app.inject('/api/search?q=%20Tom%20%20Hanks%20');
    expect(res.statusCode).toBe(200);
    expect(res.json().results.map((r: { type: string }) => r.type)).toEqual(['tv', 'movie']);
    const before = fake.calls.length;
    await app.inject('/api/search?q=tom hanks');
    expect(fake.calls.length).toBe(before);
  });

  it.each(['/api/search?q=', '/api/search?q=%20%20', '/api/search', '/api/search?q=%09'])(
    '%s -> 400 standard error',
    async (url) => {
      const res = await app.inject(url);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({ code: 'invalid_request' });
      expect(res.json().error.hint).toBeTruthy();
    },
  );

  it('movie details include imdbId, runtime and genres', async () => {
    const res = await app.inject('/api/movie/278');
    expect(res.json()).toMatchObject({
      type: 'movie',
      tmdbId: 278,
      imdbId: 'tt0111161',
      runtime: 142,
      genres: ['Drama', 'Crime'],
    });
  });

  it('show details include seasons and imdbId; season lists episodes', async () => {
    const show = (await app.inject('/api/tv/1396')).json();
    expect(show.imdbId).toBe('tt0903747');
    expect(show.seasons.map((s: { seasonNumber: number }) => s.seasonNumber)).toEqual([1, 2]);
    const season = (await app.inject('/api/tv/1396/season/1')).json();
    expect(season.episodes).toHaveLength(2);
  });

  it.each(['/api/movie/999', '/api/tv/999', '/api/tv/1396/season/99'])('%s -> 404 standard error', async (url) => {
    const res = await app.inject(url);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: 'not_found' });
  });

  it.each([
    '/api/movie/abc',
    '/api/movie/0',
    '/api/movie/-5',
    '/api/movie/1.5',
    '/api/movie/99999999999999999999',
    '/api/tv/abc',
    '/api/tv/1396/season/x',
    '/api/tv/1396/season/-1',
  ])('%s -> 400', async (url) => {
    const before = fake.calls.length;
    const res = await app.inject(url);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_request');
    expect(fake.calls.length).toBe(before);
  });

  it('does not cache a 404', async () => {
    await app.inject('/api/movie/999');
    const rows = app.ctx.db.prepare("SELECT key FROM tmdb_cache WHERE key = 'movie:999'").all();
    expect(rows).toHaveLength(0);
  });

  it('maps TMDB outages to 502 with a hint, never 500', async () => {
    fake.failWith = { status: 503 };
    const res = await app.inject('/api/movie/278');
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatchObject({ code: 'tmdb_unavailable' });
    expect(res.json().error.hint).toBeTruthy();
    fake.failWith = 'network';
    expect((await app.inject('/api/home')).statusCode).toBe(502);
  });
});

describe('cache persistence', () => {
  it('survives a restart on the same DATA_DIR', async () => {
    const dir = tempDir('persist');
    const first = await boot(dir);
    await first.inject('/api/home');
    await first.inject('/api/movie/278');
    await first.close();
    closeDbs();

    const callsBefore = fake.calls.length;
    const second = await boot(dir);
    expect((await second.inject('/api/home')).statusCode).toBe(200);
    expect((await second.inject('/api/movie/278')).statusCode).toBe(200);
    expect(fake.calls.length).toBe(callsBefore);
    await second.close();
  });
});

describe('without TMDB_READ_TOKEN', () => {
  it('returns 503 config_missing naming the key on every catalog endpoint', async () => {
    const dir = tempDir('notoken');
    const config = testConfig(dir, {}, 'GATEWAY_MANIFEST_URL=https://gw.example.test/stremio/a/b/manifest.json\n');
    const instance = await buildApp(config, { logger: createSilentLogger() });
    for (const url of ['/api/home', '/api/search?q=dune', '/api/movie/278', '/api/tv/1396', '/api/tv/1396/season/1']) {
      const res = await instance.inject(url);
      expect(res.statusCode, url).toBe(503);
      const error = res.json().error;
      expect(error.code).toBe('config_missing');
      expect(typeof error.message).toBe('string');
      expect(error.hint).toContain('TMDB_READ_TOKEN');
    }
    expect((await instance.inject('/api/info')).statusCode).toBe(200);
    await instance.close();
  });
});
