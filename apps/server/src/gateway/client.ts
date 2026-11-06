import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { AppError } from '../errors.js';
import { GatewayCache } from './cache.js';
import { RateLimiter } from './rateLimiter.js';
import { placeholderName } from '../playback/resolveUrl.js';
import { GATEWAY_USER_AGENT, gatewayPath, queryKey, streamId, type GatewayStream, type StreamQuery } from './types.js';

const GATEWAY_TIMEOUT_MS = 30_000;
/** An uncached link can block while AIOStreams adds the item to TorBox. */
const PLAYBACK_TIMEOUT_MS = 60_000;

export type GatewayFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal; method?: string; redirect?: 'manual' | 'follow' },
) => Promise<Response>;

/**
 * What one request to a stream's playback link showed, read from the first response only (the redirect is never followed).
 * `placeholder` carries the clip name: `downloading`, `store_limit_exceeded`, `429`, ...
 */
export type PlaybackProbe =
  | { kind: 'placeholder'; name: string }
  | { kind: 'available' }
  | { kind: 'timeout' }
  | { kind: 'rate_limited' }
  | { kind: 'failed'; status: number | null };

export interface LookupOptions {
  /** Skips the 60 min stream-list cache and stores the fresh answer in it. */
  fresh?: boolean;
}

export interface GatewayClientOptions {
  config: Pick<Config, 'gatewayManifestUrl' | 'configFile'>;
  db: Db;
  logger: FastifyBaseLogger;
  fetch?: GatewayFetch;
  now?: () => number;
  limiter?: RateLimiter;
  timeoutMs?: number;
  playbackTimeoutMs?: number;
}

export interface GatewayStats {
  requests: number;
  errors: number;
  lastLatencyMs: number | null;
  lastLookupAt: number | null;
  lastError: string | null;
}

function filenameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(last);
  } catch {
    return '';
  }
}

interface RawStreamData {
  type?: unknown;
  service?: { cached?: unknown } | null;
  torrent?: { infoHash?: unknown; fileIdx?: unknown } | null;
  size?: unknown;
}

/** Only the fields downloads need; everything else AIOStreams puts in `streamData` is dropped. */
function parseStreamData(
  value: unknown,
): Pick<GatewayStream, 'cached' | 'infoHash' | 'fileIdx' | 'kind'> & { size: number } {
  const data = (value && typeof value === 'object' ? value : {}) as RawStreamData;
  const result: Pick<GatewayStream, 'cached' | 'infoHash' | 'fileIdx' | 'kind'> & { size: number } = { size: 0 };
  if (typeof data.service?.cached === 'boolean') result.cached = data.service.cached;
  const hash = data.torrent?.infoHash;
  if (typeof hash === 'string' && /^[0-9a-f]{40}$/i.test(hash)) result.infoHash = hash.toLowerCase();
  const fileIdx = data.torrent?.fileIdx;
  if (typeof fileIdx === 'number' && Number.isInteger(fileIdx) && fileIdx >= 0) result.fileIdx = fileIdx;
  if (typeof data.type === 'string' && data.type) result.kind = data.type;
  const size = Number(data.size);
  if (Number.isFinite(size) && size > 0) result.size = Math.round(size);
  return result;
}

export function parseGatewayResponse(body: unknown): GatewayStream[] {
  const list = (body as { streams?: unknown } | null)?.streams;
  if (!Array.isArray(list)) throw new Error('response has no streams array');
  const seen = new Set<string>();
  const result: GatewayStream[] = [];
  for (const item of list) {
    const raw = item as {
      name?: unknown;
      url?: unknown;
      behaviorHints?: { filename?: unknown; videoSize?: unknown } | null;
      streamData?: unknown;
    };
    if (typeof raw?.url !== 'string' || !/^https?:\/\//i.test(raw.url)) continue;
    const id = streamId(raw.url);
    if (seen.has(id)) continue;
    seen.add(id);
    const hints = raw.behaviorHints ?? {};
    const filename =
      typeof hints.filename === 'string' && hints.filename.trim() ? hints.filename.trim() : filenameFromUrl(raw.url);
    const size = Number(hints.videoSize);
    const { size: dataSize, ...data } = parseStreamData(raw.streamData);
    result.push({
      id,
      name: typeof raw.name === 'string' ? raw.name : '',
      url: raw.url,
      filename,
      videoSize: Number.isFinite(size) && size > 0 ? Math.round(size) : dataSize,
      ...data,
    });
  }
  return result;
}

export class GatewayClient {
  readonly cache: GatewayCache;
  readonly limiter: RateLimiter;
  readonly stats: GatewayStats = { requests: 0, errors: 0, lastLatencyMs: null, lastLookupAt: null, lastError: null };
  /** Lookup totals for the metrics endpoint (the request and error totals are in `stats`). */
  readonly cacheStats = { hits: 0, misses: 0 };
  private readonly fetchImpl: GatewayFetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly playbackTimeoutMs: number;
  private readonly inflight = new Map<string, Promise<GatewayStream[]>>();

  constructor(private readonly options: GatewayClientOptions) {
    this.now = options.now ?? Date.now;
    this.cache = new GatewayCache(options.db, this.now);
    this.limiter = options.limiter ?? new RateLimiter();
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? GATEWAY_TIMEOUT_MS;
    this.playbackTimeoutMs = options.playbackTimeoutMs ?? PLAYBACK_TIMEOUT_MS;
  }

  get configured(): boolean {
    return !!this.options.config.gatewayManifestUrl;
  }

  close(): void {
    this.limiter.close();
  }

  /** Cached for 60 min; identical concurrent lookups share one request; all requests go through the shared limiter. */
  async lookup(query: StreamQuery, options: LookupOptions = {}): Promise<GatewayStream[]> {
    const base = this.requireBase();
    const key = queryKey(query);

    if (!options.fresh) {
      const cached = this.cache.getFresh(key);
      if (cached) {
        this.cacheStats.hits += 1;
        return cached.streams;
      }
    }
    this.cacheStats.misses += 1;

    const flightKey = options.fresh ? `fresh:${key}` : key;
    const pending = this.inflight.get(flightKey);
    if (pending) return pending;

    const request = this.limiter
      .schedule(() => this.fetchStreams(base, query))
      .then((streams) => {
        this.cache.set(key, streams);
        return streams;
      })
      .finally(() => this.inflight.delete(flightKey));
    this.inflight.set(flightKey, request);
    return request;
  }

  /**
   * Asks the gateway for one stream's playback link once and reports what the first response was. AIOStreams answers an
   * uncached link by adding the item to TorBox and redirecting to its `downloading.mp4` clip; the redirect target is never requested.
   * Goes through the shared rate limiter. The link itself is never logged or returned.
   */
  async probePlayback(rawUrl: string): Promise<PlaybackProbe> {
    this.requireBase();
    let gatewayHost: string;
    try {
      gatewayHost = new URL(rawUrl).host;
    } catch {
      return { kind: 'failed', status: null };
    }
    return this.limiter.schedule(async (): Promise<PlaybackProbe> => {
      let response: Response;
      try {
        response = await this.fetchImpl(rawUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: { Range: 'bytes=0-0', 'User-Agent': GATEWAY_USER_AGENT },
          signal: AbortSignal.timeout(this.playbackTimeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        return timedOut ? { kind: 'timeout' } : { kind: 'failed', status: null };
      }
      await response.body?.cancel().catch(() => undefined);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return { kind: 'failed', status: response.status };
        try {
          const name = placeholderName(new URL(location, rawUrl), gatewayHost);
          return name ? { kind: 'placeholder', name } : { kind: 'available' };
        } catch {
          return { kind: 'failed', status: response.status };
        }
      }
      if (response.status === 200 || response.status === 206) return { kind: 'available' };
      if (response.status === 429) return { kind: 'rate_limited' };
      return { kind: 'failed', status: response.status };
    });
  }

  private requireBase(): string {
    const manifest = this.options.config.gatewayManifestUrl;
    if (!manifest) {
      throw new AppError(
        503,
        'config_missing',
        'The stream gateway is not configured: GATEWAY_MANIFEST_URL is missing.',
        `Add GATEWAY_MANIFEST_URL=<your AIOStreams manifest URL> to ${this.options.config.configFile.path} and restart HomeStream.`,
      );
    }
    return manifest.replace(/\/manifest\.json(?:[?#].*)?$/i, '').replace(/\/+$/, '');
  }

  private async fetchStreams(base: string, query: StreamQuery): Promise<GatewayStream[]> {
    const started = this.now();
    this.stats.requests += 1;
    try {
      const streams = await this.request(`${base}/${gatewayPath(query)}`);
      this.stats.lastLatencyMs = this.now() - started;
      this.stats.lastLookupAt = this.now();
      this.stats.lastError = null;
      return streams;
    } catch (error) {
      this.stats.errors += 1;
      this.stats.lastLatencyMs = this.now() - started;
      this.stats.lastLookupAt = this.now();
      const appError = error instanceof AppError ? error : this.unavailable('unexpected error');
      this.stats.lastError = appError.message;
      this.options.logger.warn(`Gateway lookup failed: ${appError.message}`);
      throw appError;
    }
  }

  private async request(url: string): Promise<GatewayStream[]> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': GATEWAY_USER_AGENT },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw timedOut
        ? this.unavailable(
            `no answer within ${Math.round(this.timeoutMs / 1000)} s`,
            'The gateway is slow or stuck. Try again in a minute.',
          )
        : this.unavailable('connection failed');
    }

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        throw this.unavailable(
          'HTTP 429 (rate limited)',
          'The gateway is rate limiting requests. Wait a few seconds and try again.',
        );
      }
      if (status === 401 || status === 403 || status === 404) {
        throw this.unavailable(
          `HTTP ${status}`,
          `The gateway refused the request. Check GATEWAY_MANIFEST_URL in ${this.options.config.configFile.path}.`,
        );
      }
      throw this.unavailable(`HTTP ${status}`);
    }

    try {
      return parseGatewayResponse(await response.json());
    } catch (error) {
      throw this.unavailable(`invalid response (${error instanceof Error ? error.message : 'unreadable'})`);
    }
  }

  private unavailable(problem: string, hint?: string): AppError {
    return new AppError(
      502,
      'gateway_unavailable',
      `Could not get streams from the gateway (${problem}).`,
      hint ?? 'Check your internet connection and that the AIOStreams gateway is reachable, then try again.',
    );
  }
}
