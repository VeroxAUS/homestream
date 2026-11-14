import {
  DownloadFailedEventSchema,
  DownloadProgressEventSchema,
  DownloadStartedResponseSchema,
  DownloadsResponseSchema,
  ErrorResponseSchema,
  type Download,
} from '@homestream/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { PROFILES } from '../playback/harness.js';
import {
  GATEWAY_ORIGIN,
  MOVIE_HASH,
  TORBOX_KEY,
  bootDownloadRig,
  makeFakes,
  seedUncachedMovie,
  type DownloadRig,
  type DownloadRigOptions,
} from '../downloads/rig.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

let root: string;
let rigs: DownloadRig[];

beforeEach(() => {
  root = makeTempDir('downloads');
  rigs = [];
});

afterEach(async () => {
  for (const rig of rigs) await rig.close().catch(() => undefined);
  clearSecrets();
  removeDir(root);
});

async function boot(options: DownloadRigOptions = {}): Promise<DownloadRig> {
  const rig = await bootDownloadRig(root, options);
  rigs.push(rig);
  return rig;
}

async function bootWithMovie(options: DownloadRigOptions = {}): Promise<DownloadRig> {
  const fakes = options.fakes ?? makeFakes();
  seedUncachedMovie(fakes);
  return boot({ ...options, fakes });
}

const downloadingItem = (progress: number, extra: Record<string, unknown> = {}) => ({
  hash: MOVIE_HASH,
  name: 'Movie.1994.1080p',
  download_state: 'downloading',
  progress,
  eta: 120,
  download_finished: false,
  download_present: false,
  ...extra,
});

const finishedItem = () =>
  downloadingItem(1, { download_state: 'cached', download_finished: true, download_present: true });

describe('Play on a title with no cached stream (VAL-DL-001)', () => {
  it('answers 202 downloading with the download record and asks the gateway for the link exactly once', async () => {
    const rig = await bootWithMovie();
    const { status, body } = await rig.play();
    expect(status).toBe(202);
    expect(DownloadStartedResponseSchema.parse(body)).toEqual(body);
    expect(body.status).toBe('downloading');
    const title = ((await rig.app.inject('/api/movie/278')).json() as { title: string }).title;
    expect(body.download).toMatchObject({
      mediaType: 'movie',
      tmdbId: 278,
      title,
      state: 'downloading',
      progress: 0,
    });
    expect(body.download.id).toEqual(expect.any(String));
    expect(Math.abs(body.download.startedAt - Date.now())).toBeLessThan(5_000);
    expect(body.download.season).toBeUndefined();

    const playback = rig.fakes.gateway.playbackCalls();
    expect(playback).toHaveLength(1);
    expect(playback[0]).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(playback[0]?.headers.Range).toBe('bytes=0-0');
    expect(rig.resolveCalls).toEqual([]);
    expect(rig.ofType('download.started')).toHaveLength(1);
    expect(rig.ofType('download.started')[0]?.data).toMatchObject({
      downloadId: body.download.id,
      mediaType: 'movie',
      tmdbId: 278,
    });
  });

  it('sends the AIOStreams-HomeStream user agent on every gateway request', async () => {
    const rig = await bootWithMovie();
    await rig.play();
    const calls = rig.fakes.gateway.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) expect(call.headers['User-Agent']).toBe('AIOStreams-HomeStream/1.0');
  });

  it('picks the best-ranked uncached stream that fits the device', async () => {
    const fakes = makeFakes();
    fakes.gateway.lists.set('tt0111161', [
      {
        token: 'tooBig',
        filename: 'Movie.1994.2160p.UHD.BluRay.REMUX.HDR.HEVC.mkv',
        cached: false,
        infoHash: 'b'.repeat(40),
        mode: 'store_limit_exceeded',
        size: 60_000_000_000,
      },
      {
        token: 'fits',
        filename: 'Movie.1994.1080p.BluRay.x264.mkv',
        cached: false,
        infoHash: MOVIE_HASH,
        mode: 'downloading',
      },
    ]);
    const rig = await boot({ fakes });
    const { status } = await rig.play({ device: PROFILES.p720 });
    expect(status).toBe(202);
    const playback = fakes.gateway.playbackCalls();
    expect(playback).toHaveLength(1);
    expect(playback[0]?.path).toContain('/fits/');
  });

  it('tracks episodes of a show and lists them on the show details', async () => {
    const fakes = makeFakes();
    fakes.gateway.lists.set('tt0903747:1:1', [
      {
        token: 'ep1',
        filename: 'Show.S01E01.1080p.WEB-DL.x264.mkv',
        cached: false,
        infoHash: 'c'.repeat(40),
        mode: 'downloading',
      },
    ]);
    const rig = await boot({ fakes });
    const { status, body } = await rig.play({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 1 });
    expect(status).toBe(202);
    expect(body.download).toMatchObject({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 1 });
    const details = (await rig.app.inject('/api/tv/1396')).json() as { downloads?: Download[] };
    expect(details.downloads).toEqual([expect.objectContaining({ id: body.download.id, season: 1, episode: 1 })]);
    const again = await rig.play({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 1 });
    expect(again.body.download.id).toBe(body.download.id);
    expect(fakes.gateway.playbackCalls()).toHaveLength(1);
    const other = await rig.play({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 2 });
    expect(other.status).toBe(404);
  });

  it('includes the download state on the movie details while pending and drops it afterwards', async () => {
    const rig = await bootWithMovie();
    expect(((await rig.app.inject('/api/movie/278')).json() as { download?: unknown }).download).toBeUndefined();
    const { body } = await rig.play();
    const details = (await rig.app.inject('/api/movie/278')).json() as { download?: Download };
    expect(details.download).toMatchObject({ id: body.download.id, state: 'downloading' });
    expect((await rig.app.inject({ method: 'DELETE', url: `/api/downloads/${body.download.id}` })).statusCode).toBe(
      200,
    );
    expect(((await rig.app.inject('/api/movie/278')).json() as { download?: unknown }).download).toBeUndefined();
  });

  it('answers 202 downloading and keeps checking when the gateway does not answer within the time limit', async () => {
    const fakes = makeFakes();
    seedUncachedMovie(fakes, { mode: 'hang' });
    const rig = await boot({ fakes, playbackTimeoutMs: 60 });
    const { status, body } = await rig.play();
    expect(status).toBe(202);
    expect(body.status).toBe('downloading');
    expect(fakes.gateway.playbackCalls()).toHaveLength(1);
  });

  it('starts a normal session when the link turns out to be playable', async () => {
    const fakes = makeFakes();
    seedUncachedMovie(fakes, { mode: 'available' });
    const rig = await boot({ fakes });
    const { status, body } = await rig.play();
    expect(status).not.toBe(202);
    expect(body.status).toBeUndefined();
    expect(fakes.gateway.playbackCalls()).toHaveLength(1);
    expect((await rig.app.inject('/api/downloads')).json()).toEqual({ downloads: [] });
  });

  it('does not touch the download path when a cached stream exists', async () => {
    const fakes = makeFakes();
    seedUncachedMovie(fakes, { cached: true });
    const rig = await boot({ fakes });
    const { status } = await rig.play();
    expect(status).not.toBe(202);
    expect(rig.resolveCalls).toHaveLength(1);
    expect(fakes.gateway.playbackCalls()).toEqual([]);
    expect((await rig.app.inject('/api/downloads')).json()).toEqual({ downloads: [] });
  });
});

describe('repeat Play (VAL-DL-002)', () => {
  it('returns the same pending download with no second add, gateway call or session slot', async () => {
    const rig = await bootWithMovie();
    const first = await rig.play();
    const gatewayCalls = rig.fakes.gateway.calls.length;
    const second = await rig.play();
    const third = await rig.play();
    expect(second.status).toBe(202);
    expect(second.body.download).toEqual(first.body.download);
    expect(third.body.download.id).toBe(first.body.download.id);
    expect(rig.fakes.gateway.calls).toHaveLength(gatewayCalls);
    expect(rig.fakes.gateway.playbackCalls()).toHaveLength(1);
    expect(rig.ofType('download.started')).toHaveLength(1);
    expect(((await rig.app.inject('/api/downloads')).json() as { downloads: unknown[] }).downloads).toHaveLength(1);
  });

  it('adds only once when Play is pressed several times at the same moment', async () => {
    const rig = await bootWithMovie();
    const results = await Promise.all([rig.play(), rig.play(), rig.play(), rig.play()]);
    expect(results.every((result) => result.status === 202)).toBe(true);
    expect(new Set(results.map((result) => result.body.download.id)).size).toBe(1);
    expect(rig.fakes.gateway.playbackCalls()).toHaveLength(1);
    expect(rig.ofType('download.started')).toHaveLength(1);
  });

  it('does not use a session slot even while two sessions would be the limit', async () => {
    const rig = await bootWithMovie();
    await rig.play();
    for (let i = 0; i < 5; i += 1) expect((await rig.play()).status).toBe(202);
  });
});

describe('error mapping (VAL-DL-003)', () => {
  it.each([
    ['store_limit_exceeded', 409, 'torbox_slots_full'],
    ['rate_limit_status', 429, 'gateway_rate_limited'],
    ['download_failed', 502, 'download_failed'],
    ['server_error', 502, 'download_failed'],
  ] as const)('maps %s to %i %s, leaves no download behind and allows a retry', async (mode, status, code) => {
    const fakes = makeFakes();
    const stream = seedUncachedMovie(fakes, { mode });
    const rig = await boot({ fakes });
    const result = await rig.play();
    expect(result.status).toBe(status);
    const error = ErrorResponseSchema.parse(result.body).error;
    expect(error.code).toBe(code);
    expect(error.message).toEqual(expect.any(String));
    expect(error.hint).toEqual(expect.any(String));
    expect((await rig.app.inject('/api/downloads')).json()).toEqual({ downloads: [] });
    expect(rig.ofType('download.started')).toEqual([]);

    stream.mode = 'downloading';
    const retry = await rig.play();
    expect(retry.status).toBe(202);
    expect(fakes.gateway.playbackCalls()).toHaveLength(2);
  });

  it('maps an unknown clip name to download_failed', async () => {
    const fakes = makeFakes();
    seedUncachedMovie(fakes, { mode: 'download_failed' });
    const rig = await boot({ fakes });
    expect((await rig.play()).body.error.code).toBe('download_failed');
  });
});

describe('listing and cancelling (VAL-DL-004)', () => {
  it('lists downloads newest first and cancels one without touching TorBox or the gateway', async () => {
    const fakes = makeFakes();
    seedUncachedMovie(fakes);
    fakes.gateway.lists.set('tt0903747:1:1', [
      {
        token: 'ep1',
        filename: 'Show.S01E01.1080p.WEB-DL.x264.mkv',
        cached: false,
        infoHash: 'c'.repeat(40),
        mode: 'downloading',
      },
    ]);
    const rig = await boot({ fakes });
    const movie = (await rig.play()).body.download as Download;
    fakes.clock.advance(5_000);
    const episode = (await rig.play({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 1 })).body
      .download as Download;

    const listed = DownloadsResponseSchema.parse((await rig.app.inject('/api/downloads')).json());
    expect(listed.downloads.map((download) => download.id)).toEqual([episode.id, movie.id]);
    expect(listed.downloads[0]).toMatchObject({ mediaType: 'tv', season: 1, episode: 1 });

    const gatewayCalls = fakes.gateway.calls.length;
    const removed = await rig.app.inject({ method: 'DELETE', url: `/api/downloads/${movie.id}` });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ id: movie.id });
    expect(fakes.torbox.calls).toEqual([]);
    expect(fakes.gateway.calls).toHaveLength(gatewayCalls);
    expect(
      DownloadsResponseSchema.parse((await rig.app.inject('/api/downloads')).json()).downloads.map((d) => d.id),
    ).toEqual([episode.id]);
  });

  it('answers a repeated or unknown cancel with a standard 404 and lets Play start a fresh download', async () => {
    const rig = await bootWithMovie();
    const first = (await rig.play()).body.download as Download;
    expect((await rig.app.inject({ method: 'DELETE', url: `/api/downloads/${first.id}` })).statusCode).toBe(200);
    for (const id of [first.id, 'nope-123']) {
      const res = await rig.app.inject({ method: 'DELETE', url: `/api/downloads/${id}` });
      expect(res.statusCode).toBe(404);
      expect(ErrorResponseSchema.parse(res.json()).error.code).toBe('not_found');
    }
    const again = await rig.play();
    expect(again.status).toBe(202);
    expect(again.body.download.id).not.toBe(first.id);
    expect(rig.fakes.gateway.playbackCalls()).toHaveLength(2);
  });

  it('stops polling a cancelled download', async () => {
    const rig = await bootWithMovie();
    rig.fakes.torbox.items = [downloadingItem(0.3)];
    const { download } = (await rig.play()).body;
    await rig.app.inject({ method: 'DELETE', url: `/api/downloads/${download.id}` });
    rig.fakes.clock.advance(2 * MIN);
    await rig.tick();
    expect(rig.fakes.torbox.calls).toEqual([]);
    expect(rig.ofType('download.progress')).toEqual([]);
  });
});

describe('persistence across a restart (VAL-DL-005)', () => {
  it('keeps the same download, does not add again and resumes polling', async () => {
    const fakes = makeFakes();
    seedUncachedMovie(fakes);
    const first = await boot({ fakes });
    const started = (await first.play()).body.download as Download;
    await first.close();

    const second = await boot({ fakes });
    second.app.ctx.downloads.start();
    const listed = (await second.app.inject('/api/downloads')).json() as { downloads: Download[] };
    expect(listed.downloads).toEqual([started]);

    const repeat = await second.play();
    expect(repeat.status).toBe(202);
    expect(repeat.body.download).toEqual(started);
    expect(fakes.gateway.playbackCalls()).toHaveLength(1);

    fakes.torbox.items = [downloadingItem(0.4)];
    fakes.clock.advance(MIN);
    await second.tick();
    expect(fakes.torbox.calls).toHaveLength(1);
    const after = (await second.app.inject('/api/downloads')).json() as { downloads: Download[] };
    expect(after.downloads[0]).toMatchObject({ id: started.id, startedAt: started.startedAt, progress: 0.4 });
    expect(second.ofType('download.started')).toEqual([]);
  });

  it('resumes a download that became ready while the server was down', async () => {
    const fakes = makeFakes();
    const stream = seedUncachedMovie(fakes);
    const first = await boot({ fakes });
    await first.play();
    await first.close();

    stream.cached = true;
    fakes.torbox.items = [finishedItem()];
    fakes.clock.advance(3 * MIN);
    const second = await boot({ fakes });
    await second.tick();
    expect(second.ofType('download.ready')).toHaveLength(1);
  });

  it('keeps no URLs or keys in the table', async () => {
    const rig = await bootWithMovie();
    await rig.play();
    const columns = (
      rig.app.ctx.db.prepare('PRAGMA table_info(pending_downloads)').all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(columns.length).toBeGreaterThan(5);
    for (const name of columns) expect(name).not.toMatch(/url|token|secret|link|api_?key|^key$/i);
    const dump = JSON.stringify(rig.app.ctx.db.prepare('SELECT * FROM pending_downloads').all());
    expect(dump).not.toMatch(/https?:\/\//);
    expect(dump).not.toContain(TORBOX_KEY);
    expect(dump).not.toContain('playback');
  });
});

describe('poller (VAL-DL-006)', () => {
  it('reads the TorBox list with the bearer key and the cache bypass, once a minute', async () => {
    const rig = await bootWithMovie();
    await rig.play();
    rig.fakes.torbox.items = [downloadingItem(0.25)];

    await rig.tick();
    expect(rig.fakes.torbox.calls).toEqual([]);

    rig.fakes.clock.advance(MIN);
    await rig.tick();
    expect(rig.fakes.torbox.calls).toHaveLength(1);
    expect(rig.fakes.torbox.calls[0]?.url).toContain('/v1/api/torrents/mylist?bypass_cache=true');
    expect(rig.fakes.torbox.calls[0]?.authorization).toBe(`Bearer ${TORBOX_KEY}`);

    rig.fakes.clock.advance(30_000);
    await rig.tick();
    expect(rig.fakes.torbox.calls).toHaveLength(1);
    rig.fakes.clock.advance(30_000);
    await rig.tick();
    expect(rig.fakes.torbox.calls).toHaveLength(2);
  });

  it('shares one TorBox listing between all pending downloads', async () => {
    const fakes = makeFakes();
    seedUncachedMovie(fakes);
    fakes.gateway.lists.set('tt0903747:1:1', [
      {
        token: 'ep1',
        filename: 'Show.S01E01.1080p.WEB-DL.x264.mkv',
        cached: false,
        infoHash: 'c'.repeat(40),
        mode: 'downloading',
      },
    ]);
    const rig = await boot({ fakes });
    await rig.play();
    await rig.play({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 1 });
    fakes.clock.advance(MIN);
    await rig.tick();
    expect(fakes.torbox.calls).toHaveLength(1);
  });

  it('slows down to every 5 minutes after the first hour', async () => {
    const rig = await bootWithMovie();
    await rig.play();
    rig.fakes.torbox.items = [downloadingItem(0.1)];
    rig.fakes.clock.advance(HOUR + 1_000);
    await rig.tick();
    expect(rig.fakes.torbox.calls).toHaveLength(1);
    for (const minutes of [1, 1, 1, 1]) {
      rig.fakes.clock.advance(minutes * MIN);
      await rig.tick();
    }
    expect(rig.fakes.torbox.calls).toHaveLength(1);
    rig.fakes.clock.advance(MIN + 1_000);
    await rig.tick();
    expect(rig.fakes.torbox.calls).toHaveLength(2);
  });

  it('backs off after TorBox errors and recovers', async () => {
    const rig = await bootWithMovie();
    await rig.play();
    rig.fakes.torbox.failNetwork = true;
    rig.fakes.clock.advance(MIN);
    await rig.tick();
    expect(rig.fakes.torbox.calls).toHaveLength(1);
    rig.fakes.clock.advance(MIN);
    await rig.tick();
    expect(rig.fakes.torbox.calls).toHaveLength(1);
    rig.fakes.clock.advance(MIN + 1_000);
    await rig.tick();
    expect(rig.fakes.torbox.calls).toHaveLength(2);
    const pending = (await rig.app.inject('/api/downloads')).json() as { downloads: Download[] };
    expect(pending.downloads[0]).toMatchObject({ state: 'downloading', progress: 0 });

    rig.fakes.torbox.failNetwork = false;
    rig.fakes.torbox.items = [downloadingItem(0.2)];
    rig.fakes.clock.advance(5 * MIN);
    await rig.tick();
    const after = (await rig.app.inject('/api/downloads')).json() as { downloads: Download[] };
    expect(after.downloads[0]).toMatchObject({ state: 'downloading', progress: 0.2 });
  });

  it('logs a refused key once under the downloads source and still detects readiness through the gateway', async () => {
    const fakes = makeFakes();
    const stream = seedUncachedMovie(fakes);
    const rig = await boot({ fakes });
    await rig.play();
    fakes.torbox.status = 401;
    fakes.clock.advance(MIN);
    await rig.tick();
    const logs = (await rig.app.inject('/api/logs?source=downloads&limit=100')).json() as {
      events: Array<{ message: string; level: string }>;
    };
    expect(logs.events.filter((event) => /TORBOX_API_KEY/.test(event.message))).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(TORBOX_KEY);

    stream.cached = true;
    fakes.clock.advance(5 * MIN);
    await rig.tick();
    expect(rig.ofType('download.ready')).toHaveLength(1);
  });

  it('checks the gateway every 5 minutes when no TorBox key is configured', async () => {
    const fakes = makeFakes();
    const stream = seedUncachedMovie(fakes);
    const rig = await boot({ fakes, torboxKey: false });
    await rig.play();
    const lists = fakes.gateway.listCalls().length;
    fakes.clock.advance(MIN);
    await rig.tick();
    expect(fakes.gateway.listCalls()).toHaveLength(lists);
    fakes.clock.advance(5 * MIN);
    await rig.tick();
    expect(fakes.gateway.listCalls()).toHaveLength(lists + 1);
    expect(fakes.torbox.calls).toEqual([]);
    stream.cached = true;
    fakes.clock.advance(5 * MIN);
    await rig.tick();
    expect(rig.ofType('download.ready')).toHaveLength(1);
  });
});

describe('events (VAL-DL-007)', () => {
  it('emits progress at most once a minute with non-decreasing values', async () => {
    const rig = await bootWithMovie({ limits: { fastPollMs: 10_000 } });
    await rig.play();
    let progress = 0;
    for (let i = 0; i < 18; i += 1) {
      progress += 0.04;
      rig.fakes.torbox.items = [downloadingItem(progress)];
      rig.fakes.clock.advance(10_000);
      await rig.tick();
    }
    const events = rig.ofType('download.progress');
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.length).toBeLessThanOrEqual(4);
    for (const event of events) DownloadProgressEventSchema.parse(event.data);
    const values = events.map((event) => event.data.progress as number);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(events[0]?.data).toMatchObject({
      downloadId: expect.any(String),
      mediaType: 'movie',
      tmdbId: 278,
      state: 'downloading',
    });
  });

  it('never moves progress backwards when TorBox reports less than before', async () => {
    const rig = await bootWithMovie();
    await rig.play();
    rig.fakes.torbox.items = [downloadingItem(0.5)];
    rig.fakes.clock.advance(MIN);
    await rig.tick();
    rig.fakes.torbox.items = [downloadingItem(0.2)];
    rig.fakes.clock.advance(MIN);
    await rig.tick();
    const listed = (await rig.app.inject('/api/downloads')).json() as { downloads: Download[] };
    expect(listed.downloads[0]?.progress).toBe(0.5);
  });

  it('streams download.* to SSE clients and replays a missed ready notice to the next one', async () => {
    const fakes = makeFakes();
    const stream = seedUncachedMovie(fakes);
    const rig = await boot({ fakes });
    const base = await rig.app.listen({ port: 0, host: '127.0.0.1' });
    const capture = async (until: (text: string) => boolean, timeoutMs = 4_000): Promise<string> => {
      const controller = new AbortController();
      const res = await fetch(`${base}/api/events`, { signal: controller.signal });
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let text = '';
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && !until(text)) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now())),
        ]);
        if (!chunk || chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      controller.abort();
      return text;
    };

    const live = capture((text) => text.includes('event: download.ready'));
    await new Promise((resolve) => setTimeout(resolve, 150));
    await rig.play();
    fakes.torbox.items = [downloadingItem(0.5)];
    fakes.clock.advance(MIN);
    await rig.tick();
    stream.cached = true;
    fakes.torbox.items = [finishedItem()];
    fakes.clock.advance(MIN);
    await rig.tick();
    const text = await live;
    expect(text).toMatch(/event: download\.started\ndata: \{[^\n]*"downloadId":"[^"]+"/);
    expect(text).toContain('event: download.progress');
    const ready = /event: download\.ready\ndata: (.+)\n/.exec(text)?.[1] as string;
    expect(JSON.parse(ready)).toMatchObject({
      downloadId: expect.any(String),
      title: expect.any(String),
      mediaType: 'movie',
      tmdbId: 278,
    });
    expect(text.match(/event: download\.ready/g)).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // A download that finishes with nobody connected is announced to the first client that connects afterwards.
    fakes.gateway.lists.set('tt0903747:1:1', [
      {
        token: 'ep1',
        filename: 'Show.S01E01.1080p.WEB-DL.x264.mkv',
        cached: false,
        infoHash: 'c'.repeat(40),
        mode: 'downloading',
      },
    ]);
    await rig.play({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 1 });
    (fakes.gateway.lists.get('tt0903747:1:1') ?? [])[0]!.cached = true;
    fakes.torbox.items = [finishedItem(), { ...finishedItem(), hash: 'c'.repeat(40) }];
    fakes.clock.advance(MIN);
    await rig.tick();
    const late = await capture((text2) => text2.includes('event: download.ready'));
    expect(late).toContain('"tmdbId":1396');
    expect(late).toContain('"season":1');
    const lateAgain = await capture((text2) => text2.includes('event: download.ready'), 600);
    expect(lateAgain).not.toContain('event: download.ready');
  });
});

describe('ready detection (VAL-DL-008)', () => {
  it('waits for finished AND present, re-lists streams bypassing the gateway cache, then announces ready once', async () => {
    const fakes = makeFakes();
    const stream = seedUncachedMovie(fakes);
    const rig = await boot({ fakes });
    const { download } = (await rig.play()).body;
    await rig.app.inject('/api/streams/movie/278');

    fakes.torbox.items = [
      downloadingItem(1, { download_finished: true, download_present: false, download_state: 'uploading' }),
    ];
    fakes.clock.advance(MIN);
    await rig.tick();
    expect(rig.ofType('download.ready')).toEqual([]);

    stream.cached = true;
    fakes.torbox.items = [finishedItem()];
    const lists = fakes.gateway.listCalls().length;
    fakes.clock.advance(MIN);
    await rig.tick();
    expect(fakes.gateway.listCalls().length).toBeGreaterThan(lists);
    const ready = rig.ofType('download.ready');
    expect(ready).toHaveLength(1);
    expect(ready[0]?.data).toEqual({ downloadId: download.id, title: download.title, mediaType: 'movie', tmdbId: 278 });

    fakes.clock.advance(HOUR);
    await rig.tick();
    await rig.tick();
    expect(rig.ofType('download.ready')).toHaveLength(1);
    const listed = (await rig.app.inject('/api/downloads')).json() as { downloads: Download[] };
    expect(listed.downloads[0]).toMatchObject({ id: download.id, state: 'ready', status: 'ready', progress: 1 });
    const streams = (await rig.app.inject('/api/streams/movie/278')).json() as { streams: Array<{ cached: boolean }> };
    expect(streams.streams.some((s) => s.cached)).toBe(true);
  });

  it('keeps retrying every ~2 minutes while the gateway still lists the stream as uncached', async () => {
    const fakes = makeFakes();
    const stream = seedUncachedMovie(fakes);
    const rig = await boot({ fakes });
    await rig.play();
    fakes.torbox.items = [finishedItem()];
    fakes.clock.advance(MIN);
    await rig.tick();
    expect(rig.ofType('download.ready')).toEqual([]);
    const lists = fakes.gateway.listCalls().length;

    fakes.clock.advance(MIN);
    await rig.tick();
    expect(fakes.gateway.listCalls()).toHaveLength(lists);
    fakes.clock.advance(MIN + 1_000);
    await rig.tick();
    expect(fakes.gateway.listCalls()).toHaveLength(lists + 1);
    expect(rig.ofType('download.ready')).toEqual([]);

    stream.cached = true;
    fakes.clock.advance(2 * MIN + 1_000);
    await rig.tick();
    expect(rig.ofType('download.ready')).toHaveLength(1);
  });

  it('never announces ready while the gateway lists no cached stream, however long TorBox has been finished', async () => {
    const fakes = makeFakes();
    const stream = seedUncachedMovie(fakes);
    const rig = await boot({ fakes });
    const { download } = (await rig.play()).body;
    fakes.torbox.items = [finishedItem()];
    fakes.clock.advance(MIN);
    await rig.tick();
    for (let i = 0; i < 12; i += 1) {
      fakes.clock.advance(2 * MIN + 1_000);
      await rig.tick();
    }
    expect(rig.ofType('download.ready')).toEqual([]);
    const listed = (await rig.app.inject('/api/downloads')).json() as { downloads: Download[] };
    expect(listed.downloads[0]).toMatchObject({ id: download.id, status: 'pending' });
    expect((await rig.play()).status).toBe(202);

    stream.cached = true;
    fakes.clock.advance(5 * MIN + 1_000);
    await rig.tick();
    expect(rig.ofType('download.ready')).toHaveLength(1);
  });

  it('never announces ready while every fresh lookup fails, and keeps checking afterwards', async () => {
    const fakes = makeFakes();
    const stream = seedUncachedMovie(fakes);
    const rig = await boot({ fakes });
    await rig.play();
    fakes.torbox.items = [finishedItem()];
    fakes.gateway.failLists = true;
    fakes.clock.advance(MIN);
    await rig.tick();
    for (let i = 0; i < 12; i += 1) {
      fakes.clock.advance(2 * MIN + 1_000);
      await rig.tick();
    }
    expect(rig.ofType('download.ready')).toEqual([]);

    fakes.gateway.failLists = false;
    stream.cached = true;
    fakes.clock.advance(5 * MIN + 1_000);
    await rig.tick();
    expect(rig.ofType('download.ready')).toHaveLength(1);
  });

  it('ends as failed (timeout) when TorBox finished but no cached stream ever shows up within 24 hours', async () => {
    const rig = await bootWithMovie();
    await rig.play();
    rig.fakes.torbox.items = [finishedItem()];
    rig.fakes.clock.advance(MIN);
    await rig.tick();
    rig.fakes.clock.advance(25 * HOUR);
    await rig.tick();
    expect(rig.ofType('download.ready')).toEqual([]);
    const failed = rig.ofType('download.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.data).toMatchObject({ reason: 'timeout' });
    DownloadFailedEventSchema.parse(failed[0]?.data);
  });

  it('starts a normal session from Play once the download is ready, with no second add', async () => {
    const fakes = makeFakes();
    const stream = seedUncachedMovie(fakes);
    const rig = await boot({ fakes });
    await rig.play();
    stream.cached = true;
    fakes.torbox.items = [finishedItem()];
    fakes.clock.advance(MIN);
    await rig.tick();
    expect(rig.ofType('download.ready')).toHaveLength(1);

    const playback = fakes.gateway.playbackCalls().length;
    const { status, body } = await rig.play();
    expect(status).not.toBe(202);
    expect(body.status).toBeUndefined();
    expect(rig.resolveCalls).toHaveLength(1);
    expect(fakes.gateway.playbackCalls()).toHaveLength(playback);
  });
});

describe('failure and give-up (VAL-DL-009)', () => {
  it('fails a download TorBox reports as errored', async () => {
    const rig = await bootWithMovie();
    const { download } = (await rig.play()).body;
    rig.fakes.torbox.items = [downloadingItem(0.1, { download_state: 'failed' })];
    rig.fakes.clock.advance(MIN);
    await rig.tick();
    const failed = rig.ofType('download.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.data).toMatchObject({
      downloadId: download.id,
      reason: 'torbox_error',
      mediaType: 'movie',
      tmdbId: 278,
    });
    DownloadFailedEventSchema.parse(failed[0]?.data);
    const listed = (await rig.app.inject('/api/downloads')).json() as { downloads: Download[] };
    expect(listed.downloads[0]).toMatchObject({ state: 'failed', status: 'failed' });

    rig.fakes.clock.advance(HOUR);
    await rig.tick();
    expect(rig.ofType('download.failed')).toHaveLength(1);
  });

  it('gives up on a stalled download after 6 hours without progress', async () => {
    const rig = await bootWithMovie();
    await rig.play();
    rig.fakes.torbox.items = [downloadingItem(0.1, { download_state: 'stalled (no seeds)' })];
    rig.fakes.clock.advance(MIN);
    await rig.tick();
    rig.fakes.clock.advance(5 * HOUR);
    await rig.tick();
    expect(rig.ofType('download.failed')).toEqual([]);
    rig.fakes.clock.advance(HOUR);
    await rig.tick();
    expect(rig.ofType('download.failed')).toHaveLength(1);
    expect(rig.ofType('download.failed')[0]?.data).toMatchObject({ reason: 'stalled' });
  });

  it('gives up after 24 hours and allows Play to start over', async () => {
    const rig = await bootWithMovie();
    const first = (await rig.play()).body.download as Download;
    rig.fakes.torbox.items = [downloadingItem(0.3)];
    rig.fakes.clock.advance(23 * HOUR);
    await rig.tick();
    expect(rig.ofType('download.failed')).toEqual([]);
    rig.fakes.clock.advance(HOUR + 6 * MIN);
    await rig.tick();
    expect(rig.ofType('download.failed')).toHaveLength(1);
    expect(rig.ofType('download.failed')[0]?.data).toMatchObject({ reason: 'timeout' });

    const again = await rig.play();
    expect(again.status).toBe(202);
    expect(again.body.download.id).not.toBe(first.id);
  });
});

describe('secrets (VAL-DL-001, VAL-DL-005)', () => {
  it('keeps gateway URLs, tokens and the TorBox key out of responses, events, logs and the table', async () => {
    const fakes = makeFakes();
    const stream = seedUncachedMovie(fakes);
    const rig = await boot({ fakes });
    const seen: string[] = [];
    const record = (value: unknown): void => {
      seen.push(typeof value === 'string' ? value : JSON.stringify(value));
    };
    record((await rig.play()).body);
    record((await rig.play()).body);
    fakes.torbox.items = [downloadingItem(0.5)];
    fakes.clock.advance(MIN);
    await rig.tick();
    fakes.torbox.status = 401;
    fakes.clock.advance(5 * MIN);
    await rig.tick();
    fakes.torbox.status = 200;
    stream.cached = true;
    fakes.torbox.items = [finishedItem()];
    fakes.clock.advance(10 * MIN);
    await rig.tick();
    record((await rig.app.inject('/api/downloads')).body);
    record((await rig.app.inject('/api/movie/278')).body);
    record((await rig.app.inject('/api/logs?limit=1000')).body);
    record(rig.events);
    record(rig.app.ctx.db.prepare('SELECT * FROM pending_downloads').all());
    record(rig.app.ctx.db.prepare('SELECT * FROM events').all());

    const text = seen.join('\n');
    for (const secret of [
      TORBOX_KEY,
      'aaaa1111',
      'bbbb2222cccc',
      'tokenA',
      '/api/v1/playback',
      GATEWAY_ORIGIN,
      'cdn.example.test',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain('downloads');
  });
});
