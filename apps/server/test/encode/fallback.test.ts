import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SessionResponse } from '@homestream/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { buildFailingFfmpeg, readCounter } from '../playback/failingFfmpeg.js';
import {
  bootHarness,
  fetchHls,
  generateLongSource,
  listFfmpegCommandLines,
  PROFILES,
  probeSegment,
  type Harness,
  type HarnessOptions,
} from '../playback/harness.js';

const TIMEOUT = 180_000;

let root: string;
let work: string;
let valid: string;
let corrupt: string;
const harnesses: Harness[] = [];

beforeAll(async () => {
  root = makeTempDir('fallback');
  work = path.join(root, 'work');
  valid = await generateLongSource(path.join(root, 'sources'));
  corrupt = path.join(root, 'sources', 'corrupt.mkv');
  writeFileSync(corrupt, randomBytes(2 * 1024 * 1024));
}, TIMEOUT);

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
});

afterAll(() => {
  clearSecrets();
  removeDir(root);
});

const NAMES = [
  'Movie.1994.1080p.WEB-DL.x264-A.mkv',
  'Movie.1994.1080p.WEB-DL.x264-B.mkv',
  'Movie.1994.1080p.WEB-DL.x264-C.mkv',
  'Movie.1994.1080p.WEB-DL.x264-D.mkv',
];

async function boot(files: string[], env: HarnessOptions['env'] = {}): Promise<Harness> {
  const harness = await bootHarness({
    root: makeTempDir('inst'),
    sources: Object.fromEntries(files.map((file, i) => [`s${i}`, { filename: NAMES[i] as string, path: file }])),
    env,
  });
  harnesses.push(harness);
  return harness;
}

const post = (harness: Harness, streamId: string) =>
  harness.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { mediaType: 'movie', tmdbId: 278, streamId, device: PROFILES.chromecast4k, subtitle: null },
  });

const dirs = (harness: Harness): string[] =>
  existsSync(harness.transcodeDir) ? readdirSync(harness.transcodeDir) : [];
const rows = (harness: Harness, sql: string): unknown[] => harness.db.prepare(sql).all();

/** Polls the process list every 50 ms and remembers every ffmpeg command line that mentions the instance's transcode dir. */
function pollProcesses(harness: Harness): () => Promise<string[]> {
  const seen = new Set<string>();
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      for (const line of await listFfmpegCommandLines()) if (line.includes(harness.transcodeDir)) seen.add(line);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();
  return async () => {
    stopped = true;
    await loop;
    return [...seen];
  };
}

describe('auto start fallback with real ffmpeg', () => {
  it(
    'skips a corrupt first source, plays the second and leaves nothing of the first',
    async () => {
      const harness = await boot([corrupt, valid, valid]);
      const stop = pollProcesses(harness);
      const started = Date.now();
      const res = await post(harness, 'auto');
      const seconds = (Date.now() - started) / 1000;
      expect(res.statusCode).toBe(201);
      const body = res.json() as SessionResponse;
      expect(body.streamId).toBe(harness.streamIds.s1);
      expect(body.attempts).toHaveLength(1);
      expect(body.attempts[0]).toMatchObject({ streamId: harness.streamIds.s0, code: expect.stringMatching(/.+/) });
      expect(seconds).toBeLessThan(60);
      expect(body.durationSec).toBeGreaterThan(1400);
      expect((await fetchHls(harness, body.sessionId, 'seg-0.m4s')).status).toBe(200);
      await probeSegment(harness, body.sessionId, 'seg-0.m4s', work);

      expect(dirs(harness)).toEqual([body.sessionId]);
      expect(harness.app.ctx.playback.list().map((s) => s.sessionId)).toEqual([body.sessionId]);
      expect(rows(harness, 'SELECT stream_filename, status FROM plays')).toEqual([
        { stream_filename: NAMES[1], status: 'ok' },
      ]);
      expect(rows(harness, "SELECT 1 FROM events WHERE level = 'error'")).toEqual([]);
      expect((await fetch(new URL(harness.probeCalls[0] as string))).status).toBe(404);

      await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
      const commandLines = await stop();
      expect(commandLines.filter((line) => !line.includes(body.sessionId))).toEqual([]);
      expect(dirs(harness)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'falls back when the first candidate encoder fails before its first segment (first two encoders fail)',
    async () => {
      const wrapperDir = path.join(root, 'wrapper-first-two');
      const exe = path.join(wrapperDir, 'first-two-failing-ffmpeg.exe');
      const counter = path.join(wrapperDir, 'count.txt');
      await buildFailingFfmpeg(exe, counter, { failFirst: 2 });
      const harness = await boot([valid, valid], { FFMPEG_PATH: exe });
      const res = await post(harness, 'auto');
      expect(res.statusCode).toBe(201);
      const body = res.json() as SessionResponse;
      expect(body.streamId).toBe(harness.streamIds.s1);
      expect(body.attempts).toEqual([{ streamId: harness.streamIds.s0, code: 'encoder_failed' }]);
      expect(readCounter(counter)).toBe(3);
      expect(dirs(harness)).toEqual([body.sessionId]);
      expect(rows(harness, 'SELECT status FROM plays')).toEqual([{ status: 'ok' }]);
      expect((await fetchHls(harness, body.sessionId, 'seg-0.m4s')).status).toBe(200);
      await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
      expect(dirs(harness)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'answers 502 all_streams_failed after exactly three attempts when every encoder fails',
    async () => {
      const wrapperDir = path.join(root, 'wrapper-always');
      const exe = path.join(wrapperDir, 'failing-ffmpeg.exe');
      const counter = path.join(wrapperDir, 'count.txt');
      await buildFailingFfmpeg(exe, counter);
      const harness = await boot([valid, valid, valid, valid], { FFMPEG_PATH: exe });
      const res = await post(harness, 'auto');
      expect(res.statusCode).toBe(502);
      const body = res.json() as {
        error: { code: string; message: string; hint: string };
        attempts: Array<{ streamId: string; code: string }>;
      };
      expect(body.error).toMatchObject({
        code: 'all_streams_failed',
        message: expect.any(String),
        hint: expect.any(String),
      });
      expect(body.attempts.map((a) => a.streamId)).toEqual([
        harness.streamIds.s0,
        harness.streamIds.s1,
        harness.streamIds.s2,
      ]);
      expect(readCounter(counter)).toBeGreaterThanOrEqual(3);
      expect(readCounter(counter)).toBeLessThanOrEqual(6);
      expect(dirs(harness)).toEqual([]);
      expect(rows(harness, 'SELECT 1 FROM plays')).toEqual([]);
      expect(harness.app.ctx.playback.list()).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'gives an explicit stream id one attempt and no fallback',
    async () => {
      const harness = await boot([corrupt, valid]);
      const bad = await post(harness, harness.streamIds.s0 as string);
      expect(bad.statusCode).toBeGreaterThanOrEqual(400);
      expect(bad.json()).not.toHaveProperty('attempts');
      expect((bad.json() as { error: { code: string } }).error.code).not.toBe('all_streams_failed');
      expect(harness.probeCalls).toHaveLength(1);
      expect(dirs(harness)).toEqual([]);
      expect(rows(harness, 'SELECT 1 FROM plays')).toEqual([]);

      const good = await post(harness, harness.streamIds.s1 as string);
      expect(good.statusCode).toBe(201);
      expect(good.json()).toMatchObject({ streamId: harness.streamIds.s1, attempts: [] });
      await harness.app.inject({
        method: 'DELETE',
        url: `/api/sessions/${(good.json() as SessionResponse).sessionId}`,
      });
    },
    TIMEOUT,
  );
});
