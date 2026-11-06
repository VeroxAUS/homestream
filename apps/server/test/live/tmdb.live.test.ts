import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createSilentLogger } from '../../src/logger.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');

let root: string;
let app: FastifyInstance;
let hasToken = false;

beforeAll(async () => {
  root = makeTempDir('tmdb-live');
  const config = loadConfig({
    env: { ...process.env, DATA_DIR: path.join(root, 'data'), TRANSCODE_DIR: path.join(root, 'transcode'), PORT: '0' },
    repoRoot,
  });
  hasToken = !!config.tmdbReadToken;
  app = await buildApp(config, { logger: createSilentLogger() });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  clearSecrets();
  removeDir(root);
});

interface Item {
  type: string;
  tmdbId: number;
  title: string;
  year: number | null;
  overview: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  rating: number;
}

describe('live TMDB', () => {
  beforeEach(({ skip }) => {
    if (!hasToken) skip('TMDB_READ_TOKEN is not configured (.env)');
  });

  it('home has four populated rows with absolute image urls', async () => {
    const res = await app.inject('/api/home');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.continueWatching).toEqual([]);
    const rows: [string, string][] = [
      ['trendingMovies', 'movie'],
      ['popularMovies', 'movie'],
      ['trendingShows', 'tv'],
      ['popularShows', 'tv'],
    ];
    for (const [name, type] of rows) {
      const items = body[name] as Item[];
      expect(items.length, name).toBeGreaterThanOrEqual(10);
      for (const item of items) {
        expect(item.type).toBe(type);
        expect(Number.isInteger(item.tmdbId)).toBe(true);
        expect(item.title).toMatch(/\S/);
        expect(item.year === null || Number.isInteger(item.year)).toBe(true);
        expect(typeof item.overview).toBe('string');
        expect(typeof item.rating).toBe('number');
        if (item.posterUrl) expect(item.posterUrl).toMatch(/^https:\/\/image\.tmdb\.org\/t\/p\/w342\//);
        if (item.backdropUrl) expect(item.backdropUrl).toMatch(/^https:\/\/image\.tmdb\.org\/t\/p\/w1280\//);
      }
    }
  });

  it('search finds Breaking Bad and never returns people', async () => {
    const bb = (await app.inject('/api/search?q=breaking%20bad')).json().results as Item[];
    expect(bb.find((item) => item.tmdbId === 1396)).toMatchObject({ type: 'tv' });
    const hanks = (await app.inject('/api/search?q=tom%20hanks')).json().results as Item[];
    expect(hanks.length).toBeGreaterThan(0);
    expect(hanks.every((item) => item.type === 'movie' || item.type === 'tv')).toBe(true);
  });

  it('movie details carry imdbId, runtime and genres', async () => {
    const movie = (await app.inject('/api/movie/278')).json();
    expect(movie).toMatchObject({ title: 'The Shawshank Redemption', year: 1994, imdbId: 'tt0111161' });
    expect(movie.runtime).toBeGreaterThan(0);
    expect(movie.genres.length).toBeGreaterThan(0);
    expect((await app.inject('/api/movie/693134')).json().imdbId).toBe('tt15239678');
  });

  it('show details list seasons and the season endpoint lists episodes', async () => {
    const show = (await app.inject('/api/tv/1396')).json();
    expect(show).toMatchObject({ title: 'Breaking Bad', imdbId: 'tt0903747' });
    const seasons = show.seasons as { seasonNumber: number; episodeCount: number; name: string }[];
    expect(seasons.map((s) => s.seasonNumber)).toEqual(expect.arrayContaining([1, 2, 3, 4, 5]));
    expect(seasons.find((s) => s.seasonNumber === 1)?.episodeCount).toBe(7);

    const season = (await app.inject('/api/tv/1396/season/1')).json();
    expect(season.episodes.map((e: { episodeNumber: number }) => e.episodeNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const episode of season.episodes) {
      expect(episode.name).toMatch(/\S/);
      expect(episode.stillUrl).toMatch(/^https:\/\/image\.tmdb\.org\/t\/p\/w300\//);
      expect(episode.runtime).toBeGreaterThan(0);
      expect(episode.airDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('unknown ids are 404, malformed ids are 400', async () => {
    for (const url of ['/api/movie/999999999', '/api/tv/999999999', '/api/tv/1396/season/99']) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    }
    expect((await app.inject('/api/movie/abc')).statusCode).toBe(400);
  });

  it('a repeated request is served from the SQLite cache', async () => {
    await app.inject('/api/movie/155');
    const started = performance.now();
    const res = await app.inject('/api/movie/155');
    expect(res.statusCode).toBe(200);
    expect(performance.now() - started).toBeLessThan(50);
    const row = app.ctx.db.prepare("SELECT expires_at FROM tmdb_cache WHERE key = 'movie:155'").get() as {
      expires_at: number;
    };
    expect(row.expires_at - Date.now()).toBeGreaterThan(23 * 3_600_000);
  });
});
