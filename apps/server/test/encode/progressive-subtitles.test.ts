import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { SessionResponse } from '@homestream/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import {
  bootHarness,
  fetchHls,
  listFfmpegCommandLines,
  listFfmpegPids,
  startSession,
  type Harness,
  type HarnessOptions,
} from '../playback/harness.js';
import { generateSubtitleSources, TEXT_CUES } from '../playback/subtitleSources.js';

const TIMEOUT = 180_000;
const TEXT_ENG = 4;
const TEXT_POR = 5;
const BITMAP = 6;

let root: string;
let source: string;
const harnesses: Harness[] = [];
const servers: Server[] = [];

beforeAll(async () => {
  root = makeTempDir('progressive-subs');
  source = (await generateSubtitleSources(path.join(root, 'sources'))).multi;
}, TIMEOUT);

afterAll(async () => {
  for (const harness of harnesses) await harness.close();
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  clearSecrets();
  removeDir(root);
});

async function boot(options: Partial<HarnessOptions> = {}): Promise<Harness> {
  const harness = await bootHarness({
    root: makeTempDir('inst'),
    sources: { movie: { filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', path: source } },
    ...options,
  });
  harnesses.push(harness);
  return harness;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function getSession(harness: Harness, sessionId: string): Promise<SessionResponse> {
  return (await harness.app.inject(`/api/sessions/${sessionId}`)).json();
}

async function waitForStatus(harness: Harness, sessionId: string, status: string): Promise<SessionResponse> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const session = await getSession(harness, sessionId);
    if (
      session.subtitleTracks.filter((track) => track.kind === 'text').every((track) => track.status === status) ||
      Date.now() > deadline
    ) {
      return session;
    }
    await sleep(200);
  }
}

/** Retries on the 503 a client would retry on. */
async function fetchEventually(harness: Harness, url: string) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const res = await harness.app.inject(url);
    if (res.statusCode !== 503 || Date.now() > deadline) return res;
    await sleep(500);
  }
}

const proxyOrigins = new Map<string, string>();

/** Extractors of one app instance: other test files run theirs at the same time, so match on the instance's own proxy origin. */
async function extractorCount(harness: Harness, sessionId: string): Promise<number> {
  const lines = await listFfmpegCommandLines();
  if (!proxyOrigins.has(sessionId)) {
    const origin = /http:\/\/127\.0\.0\.1:\d+\//.exec(lines.find((line) => line.includes(sessionId)) ?? '')?.[0];
    if (origin) proxyOrigins.set(sessionId, origin);
  }
  const origin = proxyOrigins.get(sessionId);
  if (!origin) throw new Error(`no ffmpeg command line to take the proxy origin of ${harness.transcodeDir} from`);
  return lines.filter((line) => line.includes('webvtt') && line.includes(origin)).length;
}

/** Processes are reaped a moment after the session answers its DELETE. */
async function expectNoExtractors(harness: Harness, sessionId: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while ((await extractorCount(harness, sessionId)) > 0 && Date.now() < deadline) await sleep(250);
  expect(await extractorCount(harness, sessionId)).toBe(0);
}

const cueLines = (body: string): string[] => body.split('\n').filter((line) => line.includes('-->'));

/** Range-capable HTTP server for the generated source; while `gate.closed`, no response sends bytes between 30 % of the file and its tail. */
async function startGatedSource(file: string): Promise<{ url: string; gate: { closed: boolean } }> {
  const size = statSync(file).size;
  const limit = Math.floor(size * 0.3);
  // The proxy warms the file's tail (index) on every session; only the middle of the file is held back.
  const tailStart = size - 8 * 1024 * 1024;
  const gate = { closed: false };
  const server = createServer((req, res) => {
    const suffix = /^bytes=-(\d+)$/.exec(req.headers.range ?? '');
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    const ranged = suffix !== null || range !== null;
    const start = suffix ? Math.max(0, size - Number(suffix[1])) : range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(ranged ? 206 : 200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/x-matroska',
      ...(ranged ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    void (async () => {
      let position = start;
      for await (const chunk of createReadStream(file, { start, end }) as AsyncIterable<Buffer>) {
        while (gate.closed && position + chunk.length > limit && position < tailStart && !res.destroyed)
          await sleep(50);
        if (res.destroyed) return;
        position += chunk.length;
        if (!res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve));
      }
      res.end();
    })().catch(() => res.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/movie.mkv`, gate };
}

describe('progressive text subtitles', () => {
  it(
    'serves a master playlist, rendition playlists and aligned WebVTT segments with absolute times',
    async () => {
      const harness = await boot();
      const started = (await startSession(harness, 'movie', 'desktop')).body;
      const { sessionId } = started;

      expect(started.playlistUrl).toBe(`/hls/${sessionId}/index.m3u8`);
      expect(started.mediaPlaylistUrl).toBe(`/hls/${sessionId}/video.m3u8`);
      const text = started.subtitleTracks.filter((track) => track.kind === 'text');
      expect(text.map((track) => [track.index, track.url, track.fullUrl])).toEqual([
        [TEXT_ENG, `/hls/${sessionId}/subs/${TEXT_ENG}/index.m3u8`, null],
        [TEXT_POR, `/hls/${sessionId}/subs/${TEXT_POR}/index.m3u8`, null],
      ]);
      expect(started.subtitleTracks.find((track) => track.index === BITMAP)).toMatchObject({ url: null });

      const master = await harness.app.inject(started.playlistUrl);
      expect(master.headers['content-type']).toContain('application/vnd.apple.mpegurl');
      const media = master.body.split('\n').filter((line) => line.startsWith('#EXT-X-MEDIA:'));
      expect(media).toHaveLength(2);
      expect(media[0]).toContain('NAME="English [4]"');
      expect(media[1]).toContain('NAME="Portuguese [5]"');
      expect(
        media.every(
          (line) => line.includes('DEFAULT=NO') && line.includes('AUTOSELECT=NO') && line.includes('TYPE=SUBTITLES'),
        ),
      ).toBe(true);
      expect(master.body).toContain('video.m3u8');
      expect(master.body).not.toContain(`/${BITMAP}/`);
      expect((await harness.app.inject(started.mediaPlaylistUrl)).body).toContain('seg-149.ts');

      const playlist = await harness.app.inject(text[0]?.url as string);
      expect(playlist.statusCode).toBe(200);
      expect(playlist.body.match(/seg-\d+\.vtt/g)).toHaveLength(Math.ceil(started.durationSec / 4));
      expect(playlist.body).toContain('#EXT-X-ENDLIST');
      expect((await harness.app.inject(text[0]?.url as string)).body).toBe(playlist.body);

      const segment = async (index: number, track = TEXT_ENG) =>
        harness.app.inject(`/hls/${sessionId}/subs/${track}/seg-${index}.vtt`);
      const first = await segment(0);
      expect(first.statusCode).toBe(200);
      expect(first.headers['content-type']).toBe('text/vtt; charset=utf-8');
      expect(first.headers['cache-control']).toBe('no-cache');
      expect(first.body.startsWith('WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n')).toBe(true);
      expect(cueLines(first.body)).toEqual(['00:00:02.000 --> 00:00:04.000']);
      expect(cueLines((await segment(1)).body)).toEqual(['00:00:04.000 --> 00:00:05.000']);
      expect(cueLines((await segment(2)).body)).toEqual(['00:00:10.000 --> 00:00:12.000']);
      expect(cueLines((await segment(3)).body)).toEqual(['00:00:12.000 --> 00:00:14.000']);
      expect(cueLines((await segment(4)).body)).toEqual([]);
      expect((await segment(4)).body).toBe('WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n\n');
      expect(cueLines((await segment(7)).body)).toEqual(['00:00:30.000 --> 00:00:32.000']);
      expect((await segment(0, TEXT_POR)).body).toContain('First text cue (pt)');

      await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
    },
    TIMEOUT,
  );

  it(
    'completes the full file, equal for a session that starts later, and covers earlier segments after a late start',
    async () => {
      const harness = await boot();
      const first = (await startSession(harness, 'movie', 'desktop')).body;
      const done = await waitForStatus(harness, first.sessionId, 'complete');
      const track = done.subtitleTracks.find((item) => item.index === TEXT_ENG);
      expect(track).toMatchObject({ status: 'complete', fullUrl: `/hls/${first.sessionId}/subs/${TEXT_ENG}.vtt` });

      const full = await harness.app.inject(track?.fullUrl as string);
      expect(full.statusCode).toBe(200);
      expect(full.headers['content-type']).toBe('text/vtt; charset=utf-8');
      expect(full.body.startsWith('WEBVTT')).toBe(true);
      const lines = cueLines(full.body);
      expect(lines).toHaveLength(TEXT_CUES.length);
      expect(lines[0]).toBe('00:00:02.000 --> 00:00:05.000');
      expect(lines[2]).toBe('00:00:30.000 --> 00:00:34.000');
      expect(full.body).toContain('Second text cue');

      const later = (await startSession(harness, 'movie', 'desktop', { startPositionSec: 400 })).body;
      // Nothing reads the part before the start position by itself; asking for it starts an on-demand run there.
      const early = await fetchEventually(harness, `/hls/${later.sessionId}/subs/${TEXT_ENG}/seg-2.vtt`);
      expect(early.statusCode).toBe(200);
      expect(cueLines(early.body)).toEqual(['00:00:10.000 --> 00:00:12.000']);
      await waitForStatus(harness, later.sessionId, 'complete');
      const laterFull = await harness.app.inject(`/hls/${later.sessionId}/subs/${TEXT_ENG}.vtt`);
      expect(laterFull.rawPayload.equals(full.rawPayload)).toBe(true);
      for (let index = 0; index < 10; index += 1) {
        const a = await harness.app.inject(`/hls/${first.sessionId}/subs/${TEXT_ENG}/seg-${index}.vtt`);
        const b = await harness.app.inject(`/hls/${later.sessionId}/subs/${TEXT_ENG}/seg-${index}.vtt`);
        expect(b.body, `segment ${index}`).toBe(a.body);
      }
      await Promise.all(
        [first, later].map((s) => harness.app.inject({ method: 'DELETE', url: `/api/sessions/${s.sessionId}` })),
      );
    },
    TIMEOUT,
  );

  it(
    'answers 404 for tracks without a rendition, segments out of range and bad names',
    async () => {
      const harness = await boot();
      const started = (await startSession(harness, 'movie', 'desktop')).body;
      const { sessionId } = started;
      for (const name of [
        `subs/${BITMAP}/index.m3u8`,
        `subs/${BITMAP}/seg-0.vtt`,
        'subs/99/index.m3u8',
        'subs/99/seg-0.vtt',
        `subs/${TEXT_ENG}/seg-${Math.ceil(started.durationSec / 4)}.vtt`,
        `subs/${TEXT_ENG}/seg-99999.vtt`,
        `subs/${TEXT_ENG}/seg-0.ts`,
        `subs/${TEXT_ENG}/other.m3u8`,
        'subs/x/index.m3u8',
        `${BITMAP}.vtt`,
        '99.vtt',
        'x.vtt',
        `${TEXT_ENG}.srt`,
      ]) {
        const res = await harness.app.inject(`/hls/${sessionId}/${name}`);
        expect(res.statusCode, name).toBe(404);
        expect(res.json().error).toMatchObject({ code: 'not_found', hint: expect.any(String) });
      }
      for (const name of [
        `subs/${TEXT_ENG}/index.m3u8`,
        `subs/${TEXT_ENG}/seg-0.vtt`,
        `subs/${TEXT_ENG}.vtt`,
        'video.m3u8',
      ]) {
        expect((await harness.app.inject(`/hls/nonexistent/${name}`)).statusCode, name).toBe(404);
      }
      await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
    },
    TIMEOUT,
  );

  it(
    'counts subtitle requests as activity for the idle timeout',
    async () => {
      const harness = await boot({ playback: { idleTimeoutMs: 3000, monitorTickMs: 300 } });
      const { sessionId } = (await startSession(harness, 'movie', 'desktop')).body;
      await extractorCount(harness, sessionId);
      for (let i = 0; i < 14; i += 1) {
        await sleep(500);
        const url = [`subs/${TEXT_ENG}/index.m3u8`, `subs/${TEXT_ENG}/seg-0.vtt`][i % 2];
        expect((await harness.app.inject(`/hls/${sessionId}/${url}`)).statusCode).toBe(200);
      }
      expect((await harness.app.inject(`/api/sessions/${sessionId}`)).statusCode).toBe(200);
      await sleep(4500);
      expect((await harness.app.inject(`/api/sessions/${sessionId}`)).statusCode).toBe(404);
      await expectNoExtractors(harness, sessionId);
    },
    TIMEOUT,
  );

  it(
    'leaves subtitle state and extractors untouched on PATCH, and stops them with the session',
    async () => {
      const harness = await boot({ playback: { monitorTickMs: 0 } });
      const started = (await startSession(harness, 'movie', 'desktop', { startPositionSec: 400 })).body;
      const { sessionId } = started;
      expect(await extractorCount(harness, sessionId)).toBeGreaterThanOrEqual(1);
      expect(await extractorCount(harness, sessionId)).toBeLessThanOrEqual(2);
      const before = (await getSession(harness, sessionId)).subtitleTracks;

      const res = await harness.app.inject({
        method: 'PATCH',
        url: `/api/sessions/${sessionId}`,
        payload: { audioIndex: 3, subtitle: { index: TEXT_ENG, mode: 'sidecar' } },
      });
      expect(res.statusCode).toBe(200);
      const after = res.json() as SessionResponse;
      expect(after.subtitleTracks.map((track) => track.url)).toEqual(before.map((track) => track.url));
      expect(await extractorCount(harness, sessionId)).toBeLessThanOrEqual(2);

      // The part before the start position is only read when it is asked for.
      expect((await fetchEventually(harness, `/hls/${sessionId}/subs/${TEXT_ENG}/seg-0.vtt`)).statusCode).toBe(200);
      await waitForStatus(harness, sessionId, 'complete');
      for (let i = 0; i < 40 && (await extractorCount(harness, sessionId)) > 0; i += 1) await sleep(250);
      await expectNoExtractors(harness, sessionId);
      expect(await listFfmpegPids(sessionId)).toHaveLength(1);

      await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
      expect(existsSync(path.join(harness.transcodeDir, sessionId))).toBe(false);
      expect(readdirSync(harness.transcodeDir)).toEqual([]);
      await expectNoExtractors(harness, sessionId);
      expect((await listFfmpegCommandLines()).filter((line) => line.includes(harness.transcodeDir))).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'holds a segment nobody has read yet, then answers 503 with Retry-After, never an empty 200; serves it once it is read',
    async () => {
      const gated = await startGatedSource(source);
      gated.gate.closed = true;
      const harness = await boot({
        playback: { resolveUrl: async () => gated.url, subtitleHoldMs: 1500, monitorTickMs: 0 },
      });
      const { sessionId } = (await startSession(harness, 'movie', 'desktop')).body;

      const early = await fetchEventually(harness, `/hls/${sessionId}/subs/${TEXT_ENG}/seg-2.vtt`);
      expect(early.statusCode).toBe(200);
      expect(cueLines(early.body)).toEqual(['00:00:10.000 --> 00:00:12.000']);

      const full = await harness.app.inject(`/hls/${sessionId}/subs/${TEXT_ENG}.vtt`);
      expect(full.statusCode).toBe(404);
      expect(full.json().error.code).toBe('subtitle_not_ready');

      const started = Date.now();
      const late = await harness.app.inject(`/hls/${sessionId}/subs/${TEXT_ENG}/seg-140.vtt`);
      expect([
        late.statusCode,
        late.headers['x-subtitle-status'],
        (await getSession(harness, sessionId)).subtitleTracks[0]?.status,
      ]).toEqual([503, undefined, 'extracting']);
      expect(late.headers['retry-after']).toBe('1');
      expect(late.headers['cache-control']).toBe('no-store');
      expect(late.json().error.code).toBe('subtitle_not_ready');
      expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
      expect(Date.now() - started).toBeLessThan(5000);
      expect(await extractorCount(harness, sessionId)).toBeLessThanOrEqual(2);

      gated.gate.closed = false;
      const served = await fetchEventually(harness, `/hls/${sessionId}/subs/${TEXT_ENG}/seg-140.vtt`);
      expect(served.statusCode).toBe(200);
      expect(served.body.startsWith('WEBVTT')).toBe(true);
      await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
    },
    TIMEOUT,
  );

  it(
    'keeps video segment serving unchanged next to the master playlist',
    async () => {
      const harness = await boot();
      const { sessionId } = (await startSession(harness, 'movie', 'desktop')).body;
      const segment = await fetchHls(harness, sessionId, 'seg-0.ts');
      expect(segment.status).toBe(200);
      expect(segment.headers['content-type']).toBe('video/mp2t');
      await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
    },
    TIMEOUT,
  );
});
