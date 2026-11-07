import type { Download } from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { DownloadLimits } from '../../src/downloads/rules.js';
import { openDatabase } from '../../src/db/index.js';
import type { BusEvent } from '../../src/events/bus.js';
import { EventBus } from '../../src/events/bus.js';
import { GatewayClient, type GatewayFetch } from '../../src/gateway/client.js';
import { RateLimiter } from '../../src/gateway/rateLimiter.js';
import { createSilentLogger } from '../../src/logger.js';
import { TmdbService } from '../../src/tmdb/service.js';
import type { TorboxFetch } from '../../src/downloads/torbox.js';
import { testConfig } from '../helpers.js';
import { PROFILES } from '../playback/harness.js';
import { CACHED_NAME, UNCACHED_NAME } from '../streams/fixtures.js';
import { makeFakeTmdb } from '../tmdb/fixtures.js';

export const GATEWAY_ORIGIN = 'https://gw.example.test';
export const TORBOX_KEY = 'tbkey-secret-0123456789';
export const MOVIE_HASH = 'a'.repeat(40);
const DEVICE = PROFILES.chromecast4k;

/** What the gateway answers for a stream's playback link. */
type PlaybackMode =
  | 'downloading'
  | 'store_limit_exceeded'
  | 'download_failed'
  | 'rate_limit_status'
  | 'available'
  | 'server_error'
  | 'hang'
  /** The clip lives on another host. */
  | 'clip_other_host'
  /** A relative Location with a query string. */
  | 'clip_relative_query'
  /** Gateway, then an intermediate host, then the clip. */
  | 'clip_two_hops'
  /** No redirect: the gateway itself serves a 200/206 clip far smaller than the listed size. */
  | 'clip_200'
  | 'clip_206'
  /** The gateway serves a file of the listed size itself. */
  | 'genuine_206';

export interface FakeStream {
  token: string;
  filename: string;
  cached: boolean;
  infoHash?: string;
  fileIdx?: number;
  size?: number;
  mode: PlaybackMode;
}

/** The size a stream is listed with unless the test overrides it (index 0). */
const LISTED_BYTES = 2_000_000_000;

interface GatewayCall {
  kind: 'list' | 'playback' | 'other';
  path: string;
  method: string;
  headers: Record<string, string>;
  redirect?: string;
}

interface FakeGateway {
  fetch: GatewayFetch;
  /** Streams per imdb id (or `imdb:s:e`). */
  lists: Map<string, FakeStream[]>;
  calls: GatewayCall[];
  /** When set, stream list requests answer HTTP 500. */
  failLists: boolean;
  playbackCalls(): GatewayCall[];
  listCalls(): GatewayCall[];
}

const redirectResponse = (status: number, location: string): Response =>
  new Response(null, { status, headers: { location } });

/** A hop that is not on the gateway host: the intermediate redirector of the two-hop clip, or a file. */
function otherHostResponse(target: URL): Response {
  if (target.pathname.startsWith('/redirect/')) return redirectResponse(302, '/static/downloading.mp4');
  return new Response(null, { status: 206, headers: { 'content-range': `bytes 0-0/${LISTED_BYTES}` } });
}

const CLIP_BYTES = 4 * 1024 * 1024;
const REDIRECTS: Partial<Record<PlaybackMode, [number, string]>> = {
  downloading: [307, `${GATEWAY_ORIGIN}/static/downloading.mp4`],
  store_limit_exceeded: [307, `${GATEWAY_ORIGIN}/static/store_limit_exceeded.mp4`],
  download_failed: [307, `${GATEWAY_ORIGIN}/static/download_failed.mp4`],
  clip_other_host: [307, 'https://static.example.test/static/downloading.mp4'],
  clip_relative_query: [302, '/static/downloading.mp4?v=3&sig=abc'],
  clip_two_hops: [307, 'https://mid.example.test/redirect/abc?sig=1'],
  available: [307, 'https://cdn.example.test/file/abc.mkv?sig=zzz'],
};

/** What the gateway answers for a stream's playback link in the given mode. */
function playbackResponse(mode: PlaybackMode, signal: AbortSignal): Response | Promise<Response> {
  const redirect = REDIRECTS[mode];
  if (redirect) return redirectResponse(redirect[0], redirect[1]);
  switch (mode) {
    case 'clip_200':
      return new Response(null, { status: 200, headers: { 'content-length': String(CLIP_BYTES) } });
    case 'clip_206':
      return new Response(null, { status: 206, headers: { 'content-range': `bytes 0-0/${CLIP_BYTES}` } });
    case 'genuine_206':
      return new Response(null, { status: 206, headers: { 'content-range': `bytes 0-0/${LISTED_BYTES}` } });
    case 'rate_limit_status':
      return new Response('slow down', { status: 429 });
    case 'server_error':
      return new Response('boom', { status: 500 });
    default:
      return new Promise<Response>((_, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
      });
  }
}

function makeFakeGateway(): FakeGateway {
  const lists = new Map<string, FakeStream[]>();
  const calls: GatewayCall[] = [];
  const byToken = (token: string): FakeStream | undefined =>
    [...lists.values()].flat().find((stream) => stream.token === token);

  const fetch: GatewayFetch = async (url, init) => {
    const target = new URL(url);
    const headers = init.headers;
    const call: GatewayCall = {
      kind: 'list',
      path: target.pathname,
      method: init.method ?? 'GET',
      headers,
      redirect: init.redirect,
    };
    calls.push(call);
    if (target.host !== new URL(GATEWAY_ORIGIN).host) {
      call.kind = 'other';
      return otherHostResponse(target);
    }
    const playback = /^\/api\/v1\/playback\/([^/]+)\//.exec(target.pathname);
    if (playback) {
      call.kind = 'playback';
      return playbackResponse(byToken(playback[1] as string)?.mode ?? 'download_failed', init.signal);
    }
    if (gateway.failLists) return new Response('boom', { status: 500 });
    const match = /\/stream\/(?:movie|series)\/([^/]+)\.json$/.exec(target.pathname);
    const key = decodeURIComponent(match?.[1] ?? '');
    const streams = lists.get(key) ?? [];
    return new Response(
      JSON.stringify({
        streams: streams.map((stream, index) => ({
          name: stream.cached ? CACHED_NAME : UNCACHED_NAME,
          url: `${GATEWAY_ORIGIN}/api/v1/playback/${stream.token}/${encodeURIComponent(stream.filename)}`,
          behaviorHints: { filename: stream.filename, videoSize: (stream.size ?? 2_000_000_000) + index },
          streamData: {
            type: 'debrid',
            service: { id: 'torbox', cached: stream.cached },
            torrent: stream.infoHash ? { infoHash: stream.infoHash, fileIdx: stream.fileIdx ?? 0 } : undefined,
            size: stream.size ?? 2_000_000_000,
          },
        })),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const gateway: FakeGateway = {
    fetch,
    lists,
    calls,
    failLists: false,
    playbackCalls: () => calls.filter((call) => call.kind === 'playback'),
    listCalls: () => calls.filter((call) => call.kind === 'list'),
  };
  return gateway;
}

interface FakeTorboxItem {
  hash: string;
  name?: string;
  download_state?: string;
  progress?: number;
  eta?: number;
  download_finished?: boolean;
  download_present?: boolean;
  alternative_hashes?: string[];
}

interface TorboxCall {
  url: string;
  authorization: string | undefined;
}

interface FakeTorbox {
  fetch: TorboxFetch;
  items: FakeTorboxItem[];
  status: number;
  /** When set, the next listing rejects like a network failure. */
  failNetwork: boolean;
  calls: TorboxCall[];
}

function makeFakeTorbox(): FakeTorbox {
  const fake: FakeTorbox = {
    items: [],
    status: 200,
    failNetwork: false,
    calls: [],
    fetch: async (url, init) => {
      fake.calls.push({ url, authorization: init.headers.Authorization });
      if (fake.failNetwork) throw new Error('connect ECONNREFUSED');
      return new Response(JSON.stringify({ success: true, data: fake.items }), { status: fake.status });
    },
  };
  return fake;
}

interface Clock {
  now: number;
  advance(ms: number): void;
}

export interface Fakes {
  gateway: FakeGateway;
  torbox: FakeTorbox;
  clock: Clock;
}

export function makeFakes(): Fakes {
  return {
    gateway: makeFakeGateway(),
    torbox: makeFakeTorbox(),
    clock: {
      now: Date.now(),
      advance(ms) {
        this.now += ms;
      },
    },
  };
}

/** A movie 278 (tt0111161) whose only stream is uncached. */
export function seedUncachedMovie(fakes: Fakes, overrides: Partial<FakeStream> = {}): FakeStream {
  const stream: FakeStream = {
    token: 'tokenA',
    filename: 'Movie.1994.1080p.BluRay.x264.mkv',
    cached: false,
    infoHash: MOVIE_HASH,
    mode: 'downloading',
    ...overrides,
  };
  fakes.gateway.lists.set('tt0111161', [stream]);
  return stream;
}

/** Either the 202 download response or an error response, whichever Play answered with. */
interface PlayBody {
  status?: string;
  download: Download;
  error: { code: string; message: string; hint?: string };
}

export interface DownloadRig {
  app: FastifyInstance;
  fakes: Fakes;
  events: BusEvent[];
  resolveCalls: string[];
  close(): Promise<void>;
  play(extra?: Record<string, unknown>): Promise<{ status: number; body: PlayBody }>;
  tick(): Promise<void>;
  ofType(type: string): BusEvent[];
}

export interface DownloadRigOptions {
  fakes?: Fakes;
  env?: Record<string, string>;
  limits?: Partial<DownloadLimits>;
  playbackTimeoutMs?: number;
  /** TORBOX_API_KEY is set unless this is false. */
  torboxKey?: boolean;
}

export async function bootDownloadRig(root: string, options: DownloadRigOptions = {}): Promise<DownloadRig> {
  const fakes = options.fakes ?? makeFakes();
  const config = testConfig(root, {
    ...(options.torboxKey === false ? {} : { TORBOX_API_KEY: TORBOX_KEY }),
    ...options.env,
  });
  const db = openDatabase(config.dataDir);
  const logger = createSilentLogger();
  const tmdb = new TmdbService({ config, db, logger, fetch: makeFakeTmdb().fetch });
  const gateway = new GatewayClient({
    config,
    db,
    logger,
    fetch: fakes.gateway.fetch,
    limiter: new RateLimiter({ maxRequests: 50, windowMs: 100, marginMs: 5 }),
    timeoutMs: 5_000,
    playbackTimeoutMs: options.playbackTimeoutMs ?? 5_000,
  });
  const bus = new EventBus();
  const events: BusEvent[] = [];
  bus.subscribe((event) => events.push(event));
  const resolveCalls: string[] = [];
  const app = await buildApp(config, {
    logger,
    db,
    tmdb,
    gateway,
    bus,
    downloads: { torboxFetch: fakes.torbox.fetch, now: () => fakes.clock.now, limits: options.limits },
    playback: {
      resolveUrl: async (raw) => {
        resolveCalls.push(raw);
        throw new Error('no real stream in this test');
      },
    },
  });
  await app.ready();
  const rig: DownloadRig = {
    app,
    fakes,
    events,
    resolveCalls,
    close: async () => {
      await app.close();
      db.close();
    },
    play: async (extra = {}) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { mediaType: 'movie', tmdbId: 278, streamId: 'auto', device: DEVICE, ...extra },
      });
      return { status: res.statusCode, body: res.json() };
    },
    tick: () => app.ctx.downloads.tick(),
    ofType: (type) => events.filter((event) => event.type === type),
  };
  return rig;
}
