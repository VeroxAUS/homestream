import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StreamOption, StreamsResponse } from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createSilentLogger } from '../../src/logger.js';
import { clearSecrets } from '../../src/redact.js';
import { RESOLUTION_RANK, sourceRank } from '../../src/streams/rank.js';
import { makeTempDir, removeDir } from '../helpers.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');

let root: string;
let app: FastifyInstance;
let configured = false;

beforeAll(async () => {
  root = makeTempDir('streams-live');
  const config = loadConfig({
    env: { ...process.env, DATA_DIR: path.join(root, 'data'), TRANSCODE_DIR: path.join(root, 'transcode'), PORT: '0' },
    repoRoot,
  });
  configured = !!config.gatewayManifestUrl && !!config.tmdbReadToken;
  app = await buildApp(config, { logger: createSilentLogger() });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  clearSecrets();
  removeDir(root);
});

function assertRanked(streams: StreamOption[]): void {
  const firstUncached = streams.findIndex((s) => !s.cached);
  if (firstUncached >= 0) expect(streams.slice(firstUncached).every((s) => !s.cached)).toBe(true);
  for (let i = 1; i < streams.length; i += 1) {
    const prev = streams[i - 1] as StreamOption;
    const cur = streams[i] as StreamOption;
    if (prev.cached !== cur.cached) continue;
    expect(RESOLUTION_RANK[prev.resolution]).toBeGreaterThanOrEqual(RESOLUTION_RANK[cur.resolution]);
    if (prev.resolution === cur.resolution)
      expect(sourceRank(prev.source)).toBeGreaterThanOrEqual(sourceRank(cur.source));
  }
}

function assertNoLeaks(body: string): void {
  expect(body).not.toMatch(/"url"/);
  expect(body).not.toMatch(/https?:\/\//i);
  expect(body).not.toContain('/api/v1/debrid/playback');
  expect(body).not.toContain('tb-cdn');
}

describe('live gateway lookups (2 real requests)', () => {
  beforeEach(({ skip }) => {
    if (!configured) skip('GATEWAY_MANIFEST_URL and TMDB_READ_TOKEN are not configured (.env)');
  });

  it('Shawshank (movie 278) returns a ranked, parsed list, then repeats from cache', async () => {
    const started = performance.now();
    const res = await app.inject('/api/streams/movie/278');
    const firstMs = performance.now() - started;
    expect(res.statusCode).toBe(200);
    expect(firstMs).toBeLessThan(25_000);

    const body = res.json() as StreamsResponse;
    expect(body.streams.length).toBeGreaterThan(0);
    expect(body.streams.some((s) => s.resolution === '1080p' || s.resolution === '2160p')).toBe(true);
    expect(body.streams.find((s) => s.id === body.recommendedId)).toBeDefined();
    for (const s of body.streams) {
      expect(s.id).toMatch(/^[0-9a-f]{16}$/);
      expect(s.sizeBytes).toBeGreaterThan(0);
      expect(s.filename.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
    }
    if (body.streams.some((s) => s.cached)) expect(body.streams.every((s) => s.cached)).toBe(true);
    assertRanked(body.streams);
    assertNoLeaks(res.body);

    const repeatStarted = performance.now();
    const again = await app.inject('/api/streams/movie/278');
    expect(performance.now() - repeatStarted).toBeLessThan(200);
    expect(again.json()).toEqual(body);

    const first = body.streams[0] as StreamOption;
    const resolved = await app.ctx.streams.getStreamById(first.id);
    expect(resolved?.url).toMatch(/^https?:\/\//);
  }, 60_000);

  it('Breaking Bad S1E1 returns streams through the series endpoint', async () => {
    const res = await app.inject('/api/streams/tv/1396/1/1');
    expect(res.statusCode).toBe(200);
    const body = res.json() as StreamsResponse;
    expect(body.streams.length).toBeGreaterThan(0);
    expect(body.streams.find((s) => s.id === body.recommendedId)).toBeDefined();
    assertRanked(body.streams);
    assertNoLeaks(res.body);
  }, 60_000);
});
