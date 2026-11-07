// @no-ffmpeg: real HTTP stubs for the gateway and the CDN, fake encoder and stubbed probe; nothing starts ffmpeg or touches the GPU.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ActivityResponse } from '@homestream/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { openDatabase } from '../../src/db/index.js';
import { GatewayClient } from '../../src/gateway/client.js';
import { RateLimiter } from '../../src/gateway/rateLimiter.js';
import { createSilentLogger } from '../../src/logger.js';
import { clearSecrets } from '../../src/redact.js';
import { TmdbService } from '../../src/tmdb/service.js';
import { makeTempDir, removeDir, testConfig } from '../helpers.js';
import { FakeEncoders } from '../playback/fakeEncoder.js';
import { PROFILES } from '../playback/harness.js';
import { UNCACHED_NAME } from '../streams/fixtures.js';
import { makeFakeTmdb } from '../tmdb/fixtures.js';

const PREFIX = '/stremio/stubsecret1/stubsecret2';
const LISTED = 2_000_000_000;
const CLIP_BYTES = 4 * 1024 * 1024;
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  clearSecrets();
});

/**
 * A gateway whose playback link leads to `/hop/1`. That file answers like a real one (the full listed size) on the first
 * request, which is what the download probe sees, and turns into a redirect to the gateway's clip afterwards.
 */
async function startFlippingGateway(
  later: 'clip_redirect' | 'small_file',
): Promise<{ manifestUrl: string; requests: string[] }> {
  const requests: string[] = [];
  let origin = '';
  let hopRequests = 0;
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '').replace(PREFIX, '');
    requests.push(url);
    if (url.startsWith('/api/v1/playback/')) {
      res.writeHead(307, { location: `${origin}/hop/1` }).end();
      return;
    }
    if (url === '/hop/1') {
      hopRequests += 1;
      if (hopRequests === 1) {
        const total = later === 'small_file' ? '*' : String(LISTED);
        res.writeHead(206, { 'content-range': `bytes 0-0/${total}`, 'content-length': '1' }).end('x');
      } else if (later === 'small_file') {
        res
          .writeHead(206, { 'content-range': `bytes 0-${CLIP_BYTES - 1}/${CLIP_BYTES}`, 'content-length': CLIP_BYTES })
          .end(Buffer.alloc(CLIP_BYTES));
      } else {
        res.writeHead(302, { location: '/hop/2' }).end();
      }
      return;
    }
    if (url === '/hop/2') {
      res.writeHead(302, { location: '/static/downloading.mp4?sig=abc' }).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        streams: [
          {
            name: UNCACHED_NAME,
            url: `${origin}/api/v1/playback/tokenA/Movie.1994.1080p.BluRay.x264.mkv`,
            behaviorHints: { filename: 'Movie.1994.1080p.BluRay.x264.mkv', videoSize: LISTED },
            streamData: {
              type: 'debrid',
              service: { id: 'torbox', cached: false },
              torrent: { infoHash: 'a'.repeat(40), fileIdx: 0 },
              size: LISTED,
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
  return { manifestUrl: `${origin}${PREFIX}/manifest.json`, requests };
}

describe('the reused playback target turns into a placeholder clip before the proxy opens it', () => {
  it.each([
    ['redirects to the clip', 'clip_redirect'],
    ['serves the clip as a file far below the listed size', 'small_file'],
  ] as const)(
    'is refused as stream_not_cached when it later %s: no clip request, no encoder',
    async (_label, later) => {
      const root = makeTempDir('uncached-proxy');
      cleanups.push(() => removeDir(root));
      const gateway = await startFlippingGateway(later);
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
        playback: { probe: async () => ({ durationSec: 120 }) as never, createEncoder: encoders.create },
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

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: 'stream_not_cached', hint: expect.any(String) } });
      expect(encoders.started).toBe(0);
      expect(((await app.inject('/api/activity')).json() as ActivityResponse).sessions).toEqual([]);
      expect(gateway.requests.some((url) => url.startsWith('/static/'))).toBe(false);
      expect(res.body).not.toContain('127.0.0.1');
    },
  );
});
