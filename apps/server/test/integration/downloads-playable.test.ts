// @no-ffmpeg: real HTTP stubs for the gateway and the CDN, fake encoder and stubbed probe; nothing starts ffmpeg or touches the GPU.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SessionResponse } from '@homestream/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { openDatabase } from '../../src/db/index.js';
import { GatewayClient } from '../../src/gateway/client.js';
import { RateLimiter } from '../../src/gateway/rateLimiter.js';
import { createSilentLogger } from '../../src/logger.js';
import type { ProbeResult } from '../../src/playback/probe.js';
import { clearSecrets } from '../../src/redact.js';
import { TmdbService } from '../../src/tmdb/service.js';
import { makeTempDir, removeDir, testConfig } from '../helpers.js';
import { FakeEncoders } from '../playback/fakeEncoder.js';
import { PROFILES } from '../playback/harness.js';
import { startStubCdn, type StubCdn } from '../sourceproxy/stubCdn.js';
import { UNCACHED_NAME } from '../streams/fixtures.js';
import { makeFakeTmdb } from '../tmdb/fixtures.js';

const PREFIX = '/stremio/stubsecret1/stubsecret2';
const MB = 1024 * 1024;
const PROBE: ProbeResult = {
  durationSec: 120,
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

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  clearSecrets();
});

interface StubGateway {
  manifestUrl: string;
  /** Request line of everything that reached the gateway, in arrival order. */
  requests: string[];
  playbackRequests(): string[];
}

/** A gateway on a real socket whose only stream is uncached but whose playback link redirects to a playable file. */
async function startPlayableGateway(cdn: StubCdn): Promise<StubGateway> {
  const requests: string[] = [];
  let origin = '';
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '').replace(PREFIX, '');
    requests.push(`${req.method} ${url}`);
    if (url.startsWith('/api/v1/playback/')) {
      res.writeHead(307, { location: cdn.url }).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        streams: [
          {
            name: UNCACHED_NAME,
            url: `${origin}/api/v1/playback/tokenA/Movie.1994.1080p.BluRay.x264.mkv`,
            behaviorHints: { filename: 'Movie.1994.1080p.BluRay.x264.mkv', videoSize: cdn.size },
            streamData: {
              type: 'debrid',
              service: { id: 'torbox', cached: false },
              torrent: { infoHash: 'a'.repeat(40), fileIdx: 0 },
              size: cdn.size,
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return {
    manifestUrl: `${origin}${PREFIX}/manifest.json`,
    requests,
    playbackRequests: () => requests.filter((line) => line.includes('/api/v1/playback/')),
  };
}

describe('Play on a stale uncached listing whose link is already playable (VAL-DL-008)', () => {
  it('asks the gateway for the playback link once and reuses the target for the session', async () => {
    const root = makeTempDir('dl-playable');
    cleanups.push(() => removeDir(root));
    const cdn = await startStubCdn({ size: 4 * MB });
    cleanups.push(() => cdn.close());
    const gateway = await startPlayableGateway(cdn);

    const config = testConfig(root, { GATEWAY_MANIFEST_URL: gateway.manifestUrl });
    const db = openDatabase(config.dataDir);
    const logger = createSilentLogger();
    const encoders = new FakeEncoders();
    const app = await buildApp(config, {
      logger,
      db,
      tmdb: new TmdbService({ config, db, logger, fetch: makeFakeTmdb().fetch }),
      gateway: new GatewayClient({
        config,
        db,
        logger,
        limiter: new RateLimiter({ maxRequests: 50, windowMs: 100, marginMs: 5 }),
        timeoutMs: 5_000,
        playbackTimeoutMs: 5_000,
      }),
      playback: { probe: async () => PROBE, createEncoder: encoders.create },
    });
    cleanups.push(async () => {
      await app.close();
      db.close();
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { mediaType: 'movie', tmdbId: 278, streamId: 'auto', device: PROFILES.chromecast4k, subtitle: null },
    });

    expect(res.statusCode).toBe(201);
    expect((res.json() as SessionResponse).attempts).toEqual([]);
    expect(gateway.playbackRequests()).toHaveLength(1);
    expect(cdn.ranges.length).toBeGreaterThan(0);
    expect(encoders.started).toBe(1);
  });
});
