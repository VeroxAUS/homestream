import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CapabilityProfile, PrefetchRequest } from '@homestream/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../../src/db/index.js';
import { EventBus } from '../../src/events/bus.js';
import { createSilentLogger } from '../../src/logger.js';
import type { ProbeResult } from '../../src/playback/probe.js';
import { PrefetchService } from '../../src/prefetch/service.js';
import { SourceProxy } from '../../src/sourceproxy/proxy.js';
import { makeTempDir, removeDir } from '../helpers.js';

const PROBE = { durationSec: 10 } as ProbeResult;
const DEVICE: CapabilityProfile = {
  deviceId: 'prefetch-unit',
  deviceName: 'Prefetch unit device',
  kind: 'tv',
  maxWidth: 1920,
  maxHeight: 1080,
  h264: true,
  hevc: true,
  hevcMain10: false,
  hdr10: false,
  maxAudioChannels: 6,
};

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let root: string;
let db: Db;
let proxy: SourceProxy;
let service: PrefetchService;
let probes: string[];
let lookups: string[];
let gate: Deferred | null;

const fileFor = (tmdbId: number): string => path.join(root, `title-${tmdbId}.mkv`);
const body = (tmdbId: number): PrefetchRequest => ({ mediaType: 'movie', tmdbId, device: DEVICE });

beforeAll(() => {
  root = makeTempDir('prefetch-unit');
  db = openDatabase(root);
  for (const id of [1, 2, 3, 4, 5]) writeFileSync(fileFor(id), Buffer.alloc(4096, id));
});

afterAll(() => {
  db.close();
  removeDir(root);
});

afterEach(async () => {
  await proxy?.close();
});

function boot(): void {
  db.exec('DELETE FROM events');
  probes = [];
  lookups = [];
  gate = null;
  proxy = new SourceProxy({
    resolveUrl: async (url) => url,
    probe: async (url) => {
      probes.push(url);
      return PROBE;
    },
    port: 0,
    logger: createSilentLogger(),
    maxPrefetchEntries: 3,
  });
  const streams = {
    cachedList: () => null,
    list: async (query: { imdbId: string }) => ({
      streams: [{ id: `stream-${query.imdbId}`, cached: true }],
      recommendedId: `stream-${query.imdbId}`,
    }),
    getStreamById: async (id: string) => {
      lookups.push(id);
      await gate?.promise;
      return { url: fileFor(Number(id.replace('stream-tt', ''))) };
    },
  };
  const tmdb = { movie: async (tmdbId: number) => ({ imdbId: `tt${tmdbId}` }) };
  service = new PrefetchService({
    tmdb,
    streams,
    proxy,
    db,
    bus: new EventBus(),
    logger: createSilentLogger(),
    streamIdBudgetMs: 50,
  } as unknown as ConstructorParameters<typeof PrefetchService>[0]);
}

function events(): Array<{ message: string; merged: boolean }> {
  const rows = db
    .prepare("SELECT message, details_json FROM events WHERE source = 'prefetch' ORDER BY id")
    .all() as Array<{ message: string; details_json: string }>;
  return rows.map((row) => ({ message: row.message, merged: JSON.parse(row.details_json).merged as boolean }));
}

describe('prefetch merging', () => {
  it('merges a repeat request for a title whose source is still warm', async () => {
    boot();
    await service.request(body(1), null);
    await service.idle();
    await service.request(body(1), null);
    await service.idle();

    expect(lookups).toEqual(['stream-tt1']);
    expect(probes).toHaveLength(1);
    expect(events().at(-1)?.merged).toBe(true);
  });

  it('warms a title again when four others pushed its source out of the proxy', async () => {
    boot();
    for (const id of [1, 2, 3, 4]) {
      await service.request(body(id), null);
      await service.idle();
    }
    // The proxy keeps the newest three prefetch-only sources, so title 1 was dropped.
    expect(proxy.stats().sources).toBe(3);
    const before = lookups.length;
    const probesBefore = probes.length;

    await service.request(body(1), null);
    await service.idle();

    expect(lookups.slice(before)).toEqual(['stream-tt1']);
    expect(probes.length).toBe(probesBefore + 1);
    expect(events().at(-1)?.merged).toBe(false);
    expect(proxy.isLive(fileFor(1))).toBe(true);
    expect(proxy.stats().sources).toBe(3);

    // Title 4 is still warm and merges without another lookup.
    const afterRevisit = lookups.length;
    await service.request(body(4), null);
    await service.idle();
    expect(lookups.length).toBe(afterRevisit);
    expect(events().at(-1)?.merged).toBe(true);
  });

  it('merges a request that arrives while the first warm-up is still running', async () => {
    boot();
    gate = deferred();
    const first = service.request(body(5), null);
    const second = service.request(body(5), null);
    gate.resolve();
    await Promise.all([first, second]);
    await service.idle();

    expect(lookups).toEqual(['stream-tt5']);
    expect(events().map((event) => event.merged)).toEqual([false, true]);
  });

  it('keeps merging while a playing session still holds the source after the prefetch hold expired', async () => {
    boot();
    await service.request(body(1), null);
    await service.idle();
    const session = await proxy.acquire(fileFor(1), 'session-1');
    for (const id of [2, 3, 4, 5]) {
      await service.request(body(id), null);
      await service.idle();
    }
    expect(proxy.isLive(fileFor(1))).toBe(true);

    const before = lookups.length;
    await service.request(body(1), null);
    await service.idle();
    expect(lookups.length).toBe(before);
    expect(events().at(-1)?.merged).toBe(true);
    session.release();
  });
});
