// @no-ffmpeg: fake encoders and a stubbed probe; nothing here starts ffmpeg or touches the GPU.
import path from 'node:path';
import type {
  ActivityResponse,
  ContinueWatchingResponse,
  HistoryResponse,
  HomeResponse,
  StatsGraphsResponse,
  StatsSummaryResponse,
} from '@homestream/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/index.js';
import { insertHiddenMarker, upsertProgress } from '../../src/db/progress.js';
import type { ProbeResult } from '../../src/playback/probe.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { FakeEncoders } from '../playback/fakeEncoder.js';
import { bootHarness, startSession, type Harness } from '../playback/harness.js';
import { BREAKING_BAD_SEASONS, makeFakeCatalog, type FakeCatalog } from '../progress/fakeCatalog.js';

const DURATION = 1000;
const PROBE: ProbeResult = {
  durationSec: DURATION,
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
const harnesses: Harness[] = [];

beforeAll(() => {
  root = makeTempDir('progress-routes');
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  for (const harness of harnesses) await harness.close();
  clearSecrets();
  removeDir(root);
});

interface Booted {
  harness: Harness;
  catalog: FakeCatalog;
}

async function boot(): Promise<Booted> {
  const catalog = makeFakeCatalog();
  const encoders = new FakeEncoders();
  const harness = await bootHarness({
    root: makeTempDir('inst'),
    sources: { movie: { filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', path: path.join(root, 'does-not-exist.mkv') } },
    probe: async () => PROBE,
    tmdbFetch: catalog.fetch,
    playback: { createEncoder: encoders.create, idleTimeoutMs: 3_600_000 },
  });
  harnesses.push(harness);
  return { harness, catalog };
}

type Profile = 'chromecast4k' | 'desktop' | 'emulator';

const startMovie = (harness: Harness, profile: Profile = 'chromecast4k', tmdbId = 278) =>
  startSession(harness, 'movie', profile, { tmdbId });

const startEpisode = (harness: Harness, season: number, episode: number, profile: Profile = 'desktop') =>
  startSession(harness, 'movie', profile, { mediaType: 'tv', tmdbId: 1396, season, episode });

async function ping(harness: Harness, sessionId: string, body: unknown) {
  return harness.app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/progress`, payload: body as object });
}

async function progressOf(harness: Harness, mediaKey: string) {
  return harness.app.inject(`/api/progress/${encodeURIComponent(mediaKey)}`);
}

const continueWatching = async (harness: Harness) =>
  ((await harness.app.inject('/api/continue-watching')).json() as ContinueWatchingResponse).items;
const stop = (harness: Harness, sessionId: string) =>
  harness.app.inject({ method: 'DELETE', url: `/api/sessions/${sessionId}` });

/** Plays a title to `positionSec`, stops the session and leaves progress behind. */
async function watch(
  harness: Harness,
  start: Promise<{ body: { sessionId: string } }>,
  positionSec: number,
): Promise<void> {
  const { sessionId } = (await start).body;
  expect((await ping(harness, sessionId, { positionSec, state: 'playing' })).statusCode).toBe(200);
  await stop(harness, sessionId);
}

describe('POST /api/sessions/:id/progress and GET /api/progress/:mediaKey', () => {
  it('saves the position and applies the resumable rule (>= 60 s and not completed)', async () => {
    const { harness } = await boot();
    const { sessionId } = (await startMovie(harness)).body;
    expect((await progressOf(harness, 'movie:278')).statusCode).toBe(404);

    const cases: Array<[number, boolean, boolean]> = [
      [30, false, false],
      [59.9, false, false],
      [60, false, true],
      [500, false, true],
      [919, false, true],
      [920, true, false],
      [1000, true, false],
    ];
    for (const [positionSec, completed, resumable] of cases) {
      const res = await ping(harness, sessionId, { positionSec, state: 'playing' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ mediaKey: 'movie:278', positionSec, durationSec: DURATION, completed, resumable });
      const stored = await progressOf(harness, 'movie:278');
      expect(stored.json()).toEqual({
        mediaKey: 'movie:278',
        positionSec,
        durationSec: DURATION,
        completed,
        resumable,
      });
    }
  });

  it('lets a later ping from the same title reopen a completed entry', async () => {
    const { harness } = await boot();
    const { sessionId } = (await startMovie(harness)).body;
    await ping(harness, sessionId, { positionSec: 950 });
    expect((await progressOf(harness, 'movie:278')).json()).toMatchObject({ completed: true, resumable: false });
    await ping(harness, sessionId, { positionSec: 120 });
    expect((await progressOf(harness, 'movie:278')).json()).toMatchObject({
      completed: false,
      resumable: true,
      positionSec: 120,
    });
  });

  it('treats a missing state as playing and clamps the position to the duration', async () => {
    const { harness } = await boot();
    const { sessionId } = (await startMovie(harness)).body;
    const res = await ping(harness, sessionId, { positionSec: 5000 });
    expect(res.json()).toMatchObject({ positionSec: DURATION, completed: true });
  });

  it('answers 404 for an unknown session or media key, 400 for a bad body', async () => {
    const { harness } = await boot();
    const { sessionId } = (await startMovie(harness)).body;
    expect((await ping(harness, 'nope', { positionSec: 10 })).statusCode).toBe(404);
    expect((await progressOf(harness, 'movie:999999')).statusCode).toBe(404);
    expect((await progressOf(harness, `movie:${'9'.repeat(70)}`)).statusCode).toBe(404);
    for (const body of [{}, { positionSec: -1 }, { positionSec: 'ten' }, { positionSec: 10, state: 'rewinding' }]) {
      const res = await ping(harness, sessionId, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'invalid_request' } });
    }
  });

  it('keeps the session alive: a ping counts as activity', async () => {
    const { harness } = await boot();
    const { sessionId } = (await startMovie(harness)).body;
    const before = harness.app.ctx.playback.list().length;
    await ping(harness, sessionId, { positionSec: 10, state: 'paused' });
    expect(harness.app.ctx.playback.list()).toHaveLength(before);
    const activity = (await harness.app.inject('/api/activity')).json() as ActivityResponse;
    expect(activity.sessions[0]).toMatchObject({ sessionId, state: 'paused', positionSec: 10 });
  });
});

describe('watchedSec (summed playing time)', () => {
  it('counts only the time the player was playing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0));
    const { harness } = await boot();
    const { sessionId } = (await startMovie(harness)).body;
    const step = async (seconds: number, positionSec: number, state: 'playing' | 'paused' | 'buffering') => {
      vi.setSystemTime(Date.now() + seconds * 1000);
      await ping(harness, sessionId, { positionSec, state });
    };
    await step(0, 0, 'playing');
    await step(20, 20, 'playing'); // +20
    await step(10, 30, 'paused'); // +10 played before the pause
    await step(25, 30, 'playing'); // paused for 25 s: +0
    await step(15, 45, 'buffering'); // +15
    await step(10, 45, 'playing'); // buffering for 10 s: +0
    await stop(harness, sessionId);

    const history = (await harness.app.inject('/api/history')).json() as HistoryResponse;
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      sessionId,
      watchedSec: 45,
      lastPositionSec: 45,
      durationSec: DURATION,
      completed: false,
    });
    expect(history.items[0]?.endedAt).not.toBeNull();
  });

  it('credits at most 30 s for one gap between pings', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0));
    const { harness } = await boot();
    const { sessionId } = (await startMovie(harness)).body;
    vi.setSystemTime(Date.now() + 600_000);
    await ping(harness, sessionId, { positionSec: 600, state: 'playing' });
    await stop(harness, sessionId);
    const history = (await harness.app.inject('/api/history')).json() as HistoryResponse;
    expect(history.items[0]?.watchedSec).toBe(30);
  });
});

describe('GET /api/continue-watching', () => {
  it('lists resumable titles newest first with a stable shape and drops completed or <60 s ones', async () => {
    const { harness } = await boot();
    await watch(harness, startMovie(harness, 'chromecast4k', 278), 300);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await watch(harness, startEpisode(harness, 3, 1), 40); // below 60 s
    await watch(harness, startMovie(harness, 'chromecast4k', 693134), 970); // completed

    expect(await continueWatching(harness)).toMatchObject([
      { mediaKey: 'movie:278', type: 'movie', tmdbId: 278, positionSec: 300, durationSec: DURATION, upNext: false },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await watch(harness, startEpisode(harness, 1, 3), 200);
    const items = await continueWatching(harness);
    expect(items.map((item) => item.mediaKey)).toEqual(['tv:1396:1:3', 'movie:278']);
    expect(items[0]).toMatchObject({
      type: 'tv',
      season: 1,
      episode: 3,
      showTitle: 'Show 1396',
      title: 'Show 1396',
      positionSec: 200,
      upNext: false,
    });
    expect(items[0]?.episodeTitle).toBeTruthy();
    expect(items[1]?.posterUrl).toBeTruthy();
  });

  it('keeps one entry per show: the most recently watched episode', async () => {
    const { harness } = await boot();
    await watch(harness, startEpisode(harness, 1, 2), 300);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await watch(harness, startEpisode(harness, 1, 4), 100);
    const items = await continueWatching(harness);
    expect(items.map((item) => item.mediaKey)).toEqual(['tv:1396:1:4']);
  });

  it('puts the next episode up next, with position 0, once an episode is completed', async () => {
    const { harness } = await boot();
    await watch(harness, startEpisode(harness, 1, 2), 950);
    const items = await continueWatching(harness);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      mediaKey: 'tv:1396:1:3',
      season: 1,
      episode: 3,
      positionSec: 0,
      upNext: true,
      showTitle: 'Show 1396',
    });
    expect((await progressOf(harness, 'tv:1396:1:3')).statusCode).toBe(404);
  });

  it('rolls over to the next season: Breaking Bad S1E7 completed surfaces S2E1', async () => {
    const { harness } = await boot();
    await watch(harness, startEpisode(harness, 1, BREAKING_BAD_SEASONS[1] as number), 960);
    const items = await continueWatching(harness);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ mediaKey: 'tv:1396:2:1', season: 2, episode: 1, positionSec: 0, upNext: true });
  });

  it('shows nothing up next after the series finale', async () => {
    const { harness } = await boot();
    await watch(harness, startEpisode(harness, 5, BREAKING_BAD_SEASONS[5] as number), 980);
    expect(await continueWatching(harness)).toEqual([]);
  });

  it('replaces the up-next entry with the resumable episode once that is started', async () => {
    const { harness } = await boot();
    await watch(harness, startEpisode(harness, 1, 2), 950);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await watch(harness, startEpisode(harness, 1, 3), 120);
    const items = await continueWatching(harness);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ mediaKey: 'tv:1396:1:3', positionSec: 120, upNext: false });
  });

  it('never returns more than 20 items', async () => {
    const { harness } = await boot();
    seedProgress(harness.db, 25);
    const items = await continueWatching(harness);
    expect(items).toHaveLength(20);
    expect(items.map((item) => item.tmdbId)).toEqual(Array.from({ length: 20 }, (_, i) => 5000 + 24 - i));
  });
});

describe('DELETE /api/continue-watching/:mediaKey', () => {
  it('removes the entry from the row but keeps history, and a new ping brings it back', async () => {
    const { harness } = await boot();
    const { sessionId } = (await startMovie(harness)).body;
    await ping(harness, sessionId, { positionSec: 300 });
    expect((await continueWatching(harness)).map((item) => item.mediaKey)).toEqual(['movie:278']);

    const del = await harness.app.inject({ method: 'DELETE', url: '/api/continue-watching/movie:278' });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ mediaKey: 'movie:278', removed: true });
    expect(await continueWatching(harness)).toEqual([]);

    const history = (await harness.app.inject('/api/history')).json() as HistoryResponse;
    expect(history.total).toBe(1);
    expect(history.items[0]?.mediaKey).toBe('movie:278');
    expect((await progressOf(harness, 'movie:278')).statusCode).toBe(200);
    expect(((await harness.app.inject('/api/home')).json() as HomeResponse).continueWatching).toEqual([]);

    const again = await harness.app.inject({ method: 'DELETE', url: '/api/continue-watching/movie:278' });
    expect(again.json()).toEqual({ mediaKey: 'movie:278', removed: false });

    await ping(harness, sessionId, { positionSec: 400 });
    expect((await continueWatching(harness)).map((item) => item.mediaKey)).toEqual(['movie:278']);
  });

  it('answers 404 for a key that is not in progress', async () => {
    const { harness } = await boot();
    const res = await harness.app.inject({ method: 'DELETE', url: '/api/continue-watching/movie:424242' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('removes an up-next entry and keeps it away', async () => {
    const { harness } = await boot();
    await watch(harness, startEpisode(harness, 1, 2), 950);
    expect((await continueWatching(harness)).map((item) => item.mediaKey)).toEqual(['tv:1396:1:3']);
    const del = await harness.app.inject({ method: 'DELETE', url: '/api/continue-watching/tv:1396:1:3' });
    expect(del.json()).toEqual({ mediaKey: 'tv:1396:1:3', removed: true });
    expect(await continueWatching(harness)).toEqual([]);
    expect(((await harness.app.inject('/api/history')).json() as HistoryResponse).total).toBe(1);
  });
});

describe('GET /api/tv/:tmdbId/progress', () => {
  it('lists the saved episodes of one show in order, with season and episode, and nothing else', async () => {
    const { harness } = await boot();
    await watch(harness, startEpisode(harness, 1, 2), 400);
    await watch(harness, startEpisode(harness, 1, 1), 950);
    await watch(harness, startMovie(harness), 300);
    insertHiddenMarker(harness.db, { mediaKey: 'tv:1396:1:3', tmdbId: 1396, season: 1, episode: 3, now: Date.now() });

    const res = await harness.app.inject('/api/tv/1396/progress');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [
        {
          mediaKey: 'tv:1396:1:1',
          season: 1,
          episode: 1,
          positionSec: 950,
          durationSec: DURATION,
          completed: true,
          resumable: false,
        },
        {
          mediaKey: 'tv:1396:1:2',
          season: 1,
          episode: 2,
          positionSec: 400,
          durationSec: DURATION,
          completed: false,
          resumable: true,
        },
      ],
    });
  });

  it('is empty for a show nobody watched and rejects a bad id', async () => {
    const { harness } = await boot();
    expect((await harness.app.inject('/api/tv/1396/progress')).json()).toEqual({ items: [] });
    const bad = await harness.app.inject('/api/tv/abc/progress');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'invalid_request' } });
  });
});

describe('GET /api/home', () => {
  it('carries the same continue-watching row and 3 to 5 featured items', async () => {
    const { harness } = await boot();
    await watch(harness, startMovie(harness), 300);
    const home = (await harness.app.inject('/api/home')).json() as HomeResponse;
    expect(home.continueWatching).toEqual(await continueWatching(harness));
    expect(home.continueWatching.map((item) => item.mediaKey)).toEqual(['movie:278']);
    expect(home.featured.length).toBeGreaterThanOrEqual(3);
    expect(home.featured.length).toBeLessThanOrEqual(5);
    for (const item of home.featured) {
      expect(item.backdropUrl).toBeTruthy();
      expect(item.overview).toBeTruthy();
      expect(item).not.toHaveProperty('logoUrl');
    }
    const keys = home.featured.map((item) => `${item.mediaType}:${item.tmdbId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has no "because you watched" slot before anything was watched for 60 s', async () => {
    const { harness, catalog } = await boot();
    await watch(harness, startMovie(harness), 40);
    const home = (await harness.app.inject('/api/home')).json() as HomeResponse;
    expect(home.featured.map((item) => item.reason)).not.toContain('because_you_watched');
    expect(home.featured.length).toBeGreaterThanOrEqual(3);
    expect(catalog.calls.filter((call) => call.endsWith('/recommendations'))).toEqual([]);
  });

  it('bases "because you watched" on the most recent title with >= 60 s watched', async () => {
    const { harness } = await boot();
    seedPlay(harness.db, {
      sessionId: 's1',
      tmdbId: 1396,
      type: 'tv',
      title: 'Pilot',
      showTitle: 'Breaking Bad',
      season: 1,
      episode: 1,
      startedAt: Date.now() - 3000,
      watchedSec: 400,
    });
    seedPlay(harness.db, {
      sessionId: 's2',
      tmdbId: 278,
      title: 'The Shawshank Redemption',
      startedAt: Date.now() - 2000,
      watchedSec: 900,
    });
    seedPlay(harness.db, {
      sessionId: 's3',
      tmdbId: 603,
      title: 'The Matrix',
      startedAt: Date.now() - 1000,
      watchedSec: 30,
    });
    const home = (await harness.app.inject('/api/home')).json() as HomeResponse;
    const because = home.featured.find((item) => item.reason === 'because_you_watched');
    expect(because).toMatchObject({
      tmdbId: 102,
      mediaType: 'movie',
      reasonLabel: 'Because you watched The Shawshank Redemption',
      basedOn: { mediaType: 'movie', tmdbId: 278, title: 'The Shawshank Redemption' },
    });
  });

  it('drops only the recommendation slot when TMDB recommendations fail, and still answers', async () => {
    const { harness, catalog } = await boot();
    seedPlay(harness.db, {
      sessionId: 's1',
      tmdbId: 278,
      title: 'The Shawshank Redemption',
      startedAt: Date.now() - 1000,
      watchedSec: 900,
    });
    catalog.failRecommendations = true;
    const res = await harness.app.inject('/api/home');
    expect(res.statusCode).toBe(200);
    const home = res.json() as HomeResponse;
    expect(home.featured.map((item) => item.reason)).not.toContain('because_you_watched');
    expect(home.featured.length).toBeGreaterThanOrEqual(3);
    expect(home.trendingMovies.length).toBeGreaterThan(0);
  });

  it('caches recommendations in tmdb_cache so a warm home makes no TMDB call', async () => {
    const { harness, catalog } = await boot();
    seedPlay(harness.db, {
      sessionId: 's1',
      tmdbId: 278,
      title: 'The Shawshank Redemption',
      startedAt: Date.now() - 1000,
      watchedSec: 900,
    });
    await harness.app.inject('/api/home');
    const keys = (
      harness.db.prepare("SELECT key FROM tmdb_cache WHERE key LIKE 'recommendations:%'").all() as Array<{
        key: string;
      }>
    ).map((row) => row.key);
    expect(keys).toHaveLength(1);
    const callsBefore = catalog.calls.length;
    const warm = await harness.app.inject('/api/home');
    expect(warm.statusCode).toBe(200);
    expect(catalog.calls.length).toBe(callsBefore);
  });
});

describe('GET /api/history', () => {
  async function seeded() {
    const booted = await boot();
    const base = new Date(2026, 10, 6, 12, 0, 0).getTime();
    const hour = 3_600_000;
    seedPlay(booted.harness.db, {
      sessionId: 'a',
      tmdbId: 278,
      title: 'The Shawshank Redemption',
      startedAt: base,
      deviceId: 'val-cc4k',
      deviceName: 'Val Chromecast',
    });
    seedPlay(booted.harness.db, {
      sessionId: 'b',
      tmdbId: 1396,
      type: 'tv',
      title: 'Pilot',
      showTitle: 'Breaking Bad',
      season: 1,
      episode: 1,
      startedAt: base + hour,
      deviceId: 'val-desktop',
      deviceName: 'Val Desktop',
      deviceKind: 'desktop',
    });
    seedPlay(booted.harness.db, {
      sessionId: 'c',
      tmdbId: 603,
      title: 'The Matrix',
      startedAt: base + 2 * hour,
      deviceId: 'val-cc4k',
      deviceName: 'Val Chromecast',
    });
    seedPlay(booted.harness.db, {
      sessionId: 'd',
      tmdbId: 1396,
      type: 'tv',
      title: "Cat's in the Bag...",
      showTitle: 'Breaking Bad',
      season: 1,
      episode: 2,
      startedAt: base + 3 * hour,
      deviceId: 'val-desktop',
      deviceName: 'Val Desktop',
      deviceKind: 'desktop',
    });
    seedPlay(booted.harness.db, {
      sessionId: 'e',
      tmdbId: 100,
      title: '100% Wolf',
      startedAt: base + 4 * hour,
      deviceId: 'val-emu',
      deviceName: 'Val Emulator',
    });
    const get = async (query: string) =>
      (await booted.harness.app.inject(`/api/history${query}`)).json() as HistoryResponse;
    return { ...booted, base, hour, get };
  }

  it('is newest first with camelCase plays columns', async () => {
    const { get } = await seeded();
    const page = await get('');
    expect(page.items.map((item) => item.sessionId)).toEqual(['e', 'd', 'c', 'b', 'a']);
    expect(page).toMatchObject({ total: 5, page: 1, pageSize: 20 });
    expect(page.items[3]).toMatchObject({
      type: 'tv',
      showTitle: 'Breaking Bad',
      season: 1,
      episode: 1,
      deviceId: 'val-desktop',
      deviceName: 'Val Desktop',
      deviceKind: 'desktop',
      watchedSec: 600,
      completed: false,
      status: 'ok',
    });
    expect(page.items[3]?.decision).toMatchObject({ videoCodec: 'hevc', dynamicRange: 'hdr10' });
  });

  it('filters by type, device, text, and time range', async () => {
    const { get, base, hour } = await seeded();
    expect((await get('?type=tv')).items.map((item) => item.sessionId)).toEqual(['d', 'b']);
    expect((await get('?type=movie')).total).toBe(3);
    expect((await get('?deviceId=val-cc4k')).items.map((item) => item.sessionId)).toEqual(['c', 'a']);
    expect((await get('?q=breaking')).items.map((item) => item.sessionId)).toEqual(['d', 'b']);
    expect((await get('?q=matrix')).items.map((item) => item.sessionId)).toEqual(['c']);
    expect((await get('?q=100%25')).items.map((item) => item.sessionId)).toEqual(['e']);
    expect((await get(`?from=${base + hour}&to=${base + 3 * hour}`)).items.map((item) => item.sessionId)).toEqual([
      'd',
      'c',
      'b',
    ]);
    expect((await get('?from=2026-11-06&to=2026-11-06')).total).toBe(5);
    expect((await get('?from=2026-11-07')).total).toBe(0);
    expect((await get('?type=tv&deviceId=val-desktop&q=cat')).items.map((item) => item.sessionId)).toEqual(['d']);
    expect((await get('?type=&deviceId=&q=')).total).toBe(5);
  });

  it('pages without overlap or gaps', async () => {
    const { get } = await seeded();
    const first = await get('?pageSize=2&page=1');
    const second = await get('?pageSize=2&page=2');
    const third = await get('?pageSize=2&page=3');
    const fourth = await get('?pageSize=2&page=4');
    expect([first, second, third].map((page) => page.items.map((item) => item.sessionId))).toEqual([
      ['e', 'd'],
      ['c', 'b'],
      ['a'],
    ]);
    expect(fourth.items).toEqual([]);
    expect([first.total, second.total, third.total, fourth.total]).toEqual([5, 5, 5, 5]);
    expect(second).toMatchObject({ page: 2, pageSize: 2 });
  });

  it('rejects bad parameters with 400', async () => {
    const { harness } = await seeded();
    for (const query of ['?page=0', '?pageSize=0', '?pageSize=101', '?type=anime', '?from=yesterday', '?to=-5']) {
      const res = await harness.app.inject(`/api/history${query}`);
      expect(res.statusCode, query).toBe(400);
    }
  });
});

describe('GET /api/stats/summary and /api/stats/graphs', () => {
  it('match the seeded plays exactly', async () => {
    const { harness } = await boot();
    const now = Date.now();
    const today = new Date();
    const at = (daysAgo: number, hour: number) =>
      new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour, 30).getTime();
    const hdr = decisionJson({ dynamicRange: 'hdr10', videoCodec: 'hevc', height: 2160 });
    const sdr = decisionJson({ dynamicRange: 'sdr', videoCodec: 'h264', height: 1080 });
    seedPlay(harness.db, {
      sessionId: 'p1',
      tmdbId: 278,
      title: 'The Shawshank Redemption',
      startedAt: at(2, 9),
      watchedSec: 600,
      bytesServed: 1000,
      decision: hdr,
    });
    seedPlay(harness.db, {
      sessionId: 'p2',
      tmdbId: 278,
      title: 'The Shawshank Redemption',
      startedAt: at(2, 9) + 60_000,
      watchedSec: 300,
      bytesServed: 500,
      decision: hdr,
    });
    seedPlay(harness.db, {
      sessionId: 'p3',
      tmdbId: 603,
      title: 'The Matrix',
      startedAt: at(1, 21),
      watchedSec: 100,
      bytesServed: 200,
      deviceId: 'val-desktop',
      deviceName: 'Val Desktop',
      deviceKind: 'desktop',
      decision: sdr,
    });
    seedPlay(harness.db, {
      sessionId: 'p4',
      tmdbId: 1396,
      type: 'tv',
      title: 'Pilot',
      showTitle: 'Breaking Bad',
      season: 1,
      episode: 1,
      startedAt: at(1, 21) + 60_000,
      watchedSec: 900,
      bytesServed: 3000,
      deviceId: 'val-desktop',
      deviceName: 'Val Desktop',
      deviceKind: 'desktop',
      decision: sdr,
    });
    seedPlay(harness.db, {
      sessionId: 'old',
      tmdbId: 278,
      title: 'The Shawshank Redemption',
      startedAt: now - 90 * 86_400_000,
      watchedSec: 5000,
      bytesServed: 9999,
    });

    const summary = (await harness.app.inject('/api/stats/summary?days=30')).json() as StatsSummaryResponse;
    expect(summary).toMatchObject({ days: 30, totalPlays: 4, totalWatchSec: 1900, bytesServed: 4700 });
    expect(summary.mostWatchedMovies).toEqual([
      { tmdbId: 278, title: 'The Shawshank Redemption', plays: 2, watchSec: 900 },
      { tmdbId: 603, title: 'The Matrix', plays: 1, watchSec: 100 },
    ]);
    expect(summary.mostWatchedShows).toEqual([{ tmdbId: 1396, title: 'Breaking Bad', plays: 1, watchSec: 900 }]);
    expect(summary.topDevices.map((device) => [device.deviceId, device.plays, device.watchSec])).toEqual([
      ['val-desktop', 2, 1000],
      ['val-cc4k', 2, 900],
    ]);

    const wide = (await harness.app.inject('/api/stats/summary?days=365')).json() as StatsSummaryResponse;
    expect(wide).toMatchObject({ totalPlays: 5, totalWatchSec: 6900 });
    expect((await harness.app.inject('/api/stats/summary')).json()).toMatchObject({ days: 30, totalPlays: 4 });

    const graphs = (await harness.app.inject('/api/stats/graphs?days=7')).json() as StatsGraphsResponse;
    expect(graphs.byDay).toHaveLength(7);
    expect(graphs.byDay.reduce((sum, day) => sum + day.plays, 0)).toBe(4);
    expect(graphs.byDay.reduce((sum, day) => sum + day.watchSec, 0)).toBe(1900);
    expect(graphs.byDay.at(-1)).toMatchObject({ plays: 0 });
    expect(graphs.byDay.at(-3)).toMatchObject({ plays: 2, watchSec: 900 });
    expect(graphs.byDay.at(-2)).toMatchObject({ plays: 2, watchSec: 1000 });
    expect(graphs.byHour).toHaveLength(24);
    expect(graphs.byHour[9]).toMatchObject({ hour: 9, plays: 2, watchSec: 900 });
    expect(graphs.byHour[21]).toMatchObject({ hour: 21, plays: 2, watchSec: 1000 });
    expect(graphs.byDayOfWeek).toHaveLength(7);
    expect(graphs.byDayOfWeek.reduce((sum, day) => sum + day.plays, 0)).toBe(4);
    expect(graphs.byDevice.map((device) => [device.deviceId, device.plays])).toEqual([
      ['val-desktop', 2],
      ['val-cc4k', 2],
    ]);
    expect(graphs.byDecision.dynamicRange).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'hdr10', plays: 2, watchSec: 900 }),
        expect.objectContaining({ key: 'sdr', plays: 2, watchSec: 1000 }),
      ]),
    );
    expect(graphs.byDecision.codec).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'hevc', plays: 2 }),
        expect.objectContaining({ key: 'h264', plays: 2 }),
      ]),
    );
    expect(graphs.byDecision.resolution).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: '2160p', plays: 2 }),
        expect.objectContaining({ key: '1080p', plays: 2 }),
      ]),
    );
  });

  it('answer an empty database with zeros and 400 for bad days', async () => {
    const { harness } = await boot();
    expect((await harness.app.inject('/api/stats/summary?days=7')).json()).toMatchObject({
      totalPlays: 0,
      totalWatchSec: 0,
      bytesServed: 0,
      mostWatchedMovies: [],
      topDevices: [],
    });
    const graphs = (await harness.app.inject('/api/stats/graphs?days=3')).json() as StatsGraphsResponse;
    expect(graphs.byDay).toHaveLength(3);
    expect(graphs.byHour).toHaveLength(24);
    for (const url of ['/api/stats/summary?days=0', '/api/stats/graphs?days=abc', '/api/stats/graphs?days=99999']) {
      expect((await harness.app.inject(url)).statusCode, url).toBe(400);
    }
  });
});

describe('GET /api/activity', () => {
  it('lists live sessions with media, device, state, position, decision and encoder stats', async () => {
    const { harness } = await boot();
    const movie = (await startMovie(harness, 'chromecast4k')).body;
    const episode = (await startEpisode(harness, 1, 3, 'desktop')).body;
    await ping(harness, movie.sessionId, { positionSec: 123, state: 'paused' });
    await ping(harness, episode.sessionId, { positionSec: 45, state: 'buffering' });

    const { sessions } = (await harness.app.inject('/api/activity')).json() as ActivityResponse;
    expect(sessions).toHaveLength(2);
    const byId = new Map(sessions.map((session) => [session.sessionId, session]));
    expect(byId.get(movie.sessionId)).toMatchObject({
      mediaKey: 'movie:278',
      deviceId: 'val-cc4k',
      deviceName: 'Val Chromecast',
      deviceKind: 'tv',
      state: 'paused',
      positionSec: 123,
      durationSec: DURATION,
      decision: { videoCodec: expect.any(String) },
      encoder: { fps: expect.any(Number), speed: expect.any(Number), bitrateKbps: expect.any(Number) },
    });
    expect(byId.get(episode.sessionId)).toMatchObject({
      mediaKey: 'tv:1396:1:3',
      showTitle: 'Show 1396',
      season: 1,
      episode: 3,
      deviceId: 'val-desktop',
      state: 'buffering',
      positionSec: 45,
    });

    await stop(harness, movie.sessionId);
    expect(
      ((await harness.app.inject('/api/activity')).json() as ActivityResponse).sessions.map(
        (session) => session.sessionId,
      ),
    ).toEqual([episode.sessionId]);
  });

  it('records bytes served in the play row when the session ends', async () => {
    const { harness } = await boot();
    const { sessionId } = (await startMovie(harness)).body;
    await ping(harness, sessionId, { positionSec: 10 });
    await stop(harness, sessionId);
    const row = harness.db.prepare('SELECT bytes_served, ended_at FROM plays WHERE session_id = ?').get(sessionId) as {
      bytes_served: number;
      ended_at: number | null;
    };
    expect(row.ended_at).not.toBeNull();
    expect(row.bytes_served).toBeGreaterThanOrEqual(0);
  });
});

interface SeedPlay {
  sessionId: string;
  tmdbId: number;
  type?: 'movie' | 'tv';
  title: string;
  showTitle?: string | null;
  season?: number | null;
  episode?: number | null;
  startedAt: number;
  watchedSec?: number;
  bytesServed?: number;
  deviceId?: string;
  deviceName?: string;
  deviceKind?: string;
  decision?: string;
}

function decisionJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    videoCodec: 'hevc',
    width: 3840,
    height: 2160,
    dynamicRange: 'hdr10',
    toneMapped: false,
    audioCodec: 'aac',
    audioChannels: 6,
    subtitleBurnIn: false,
    sourceVideo: { codec: 'hevc', width: 3840, height: 2160, hdr: 'hdr10' },
    sourceAudio: { codec: 'eac3', channels: 6 },
    ...overrides,
  });
}

function seedPlay(db: Db, play: SeedPlay): void {
  const type = play.type ?? 'movie';
  const mediaKey = type === 'movie' ? `movie:${play.tmdbId}` : `tv:${play.tmdbId}:${play.season}:${play.episode}`;
  db.prepare(
    `INSERT INTO plays (session_id, media_key, type, tmdb_id, title, show_title, season, episode, device_id, device_name, device_kind,
       started_at, ended_at, watched_sec, last_position_sec, duration_sec, bytes_served, decision_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok')`,
  ).run(
    play.sessionId,
    mediaKey,
    type,
    play.tmdbId,
    play.title,
    play.showTitle ?? null,
    play.season ?? null,
    play.episode ?? null,
    play.deviceId ?? 'val-cc4k',
    play.deviceName ?? 'Val Chromecast',
    play.deviceKind ?? 'tv',
    play.startedAt,
    play.startedAt + (play.watchedSec ?? 600) * 1000,
    play.watchedSec ?? 600,
    play.watchedSec ?? 600,
    7200,
    play.bytesServed ?? 0,
    play.decision ?? decisionJson(),
  );
}

function seedProgress(db: Db, count: number): void {
  const now = Date.now();
  for (let i = 0; i < count; i += 1) {
    upsertProgress(db, {
      mediaKey: `movie:${5000 + i}`,
      tmdbId: 5000 + i,
      type: 'movie',
      season: null,
      episode: null,
      positionSec: 600,
      durationSec: 7200,
      updatedAt: now - 100_000 + i * 1000,
      completed: false,
      meta: { title: `Movie ${i}`, showTitle: null, episodeTitle: null, posterUrl: null, backdropUrl: null },
    });
  }
}
