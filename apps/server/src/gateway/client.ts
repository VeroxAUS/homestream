import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { AppError } from '../errors.js';
import { GatewayCache } from './cache.js';
import { RateLimiter } from './rateLimiter.js';
import { gatewayPath, queryKey, streamId, type GatewayStream, type StreamQuery } from './types.js';

export const GATEWAY_TIMEOUT_MS = 30_000;

export type GatewayFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

export interface GatewayClientOptions {
  config: Pick<Config, 'gatewayManifestUrl' | 'configFile'>;
  db: Db;
  logger: FastifyBaseLogger;
  fetch?: GatewayFetch;
  now?: () => number;
  limiter?: RateLimiter;
  timeoutMs?: number;
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
    };
    if (typeof raw?.url !== 'string' || !/^https?:\/\//i.test(raw.url)) continue;
    const id = streamId(raw.url);
    if (seen.has(id)) continue;
    seen.add(id);
    const hints = raw.behaviorHints ?? {};
    const filename = typeof hints.filename === 'string' && hints.filename.trim() ? hints.filename.trim() : filenameFromUrl(raw.url);
    const size = Number(hints.videoSize);
    result.push({
      id,
      name: typeof raw.name === 'string' ? raw.name : '',
      url: raw.url,
      filename,
      videoSize: Number.isFinite(size) && size > 0 ? Math.round(size) : 0,
    });
  }
  return result;
}

export class GatewayClient {
  readonly cache: GatewayCache;
  readonly limiter: RateLimiter;
  readonly stats: GatewayStats = { requests: 0, errors: 0, lastLatencyMs: null, lastLookupAt: null, lastError: null };
  private readonly fetchImpl: GatewayFetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly inflight = new Map<string, Promise<GatewayStream[]>>();

  constructor(private readonly options: GatewayClientOptions) {
    this.now = options.now ?? Date.now;
    this.cache = new GatewayCache(options.db, this.now);
    this.limiter = options.limiter ?? new RateLimiter();
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? GATEWAY_TIMEOUT_MS;
  }

  get configured(): boolean {
    return !!this.options.config.gatewayManifestUrl;
  }

  close(): void {
    this.limiter.close();
  }

  /** Cached for 60 min; identical concurrent lookups share one request; all requests go through the shared limiter. */
  async lookup(query: StreamQuery): Promise<GatewayStream[]> {
    const base = this.requireBase();
    const key = queryKey(query);

    const cached = this.cache.getFresh(key);
    if (cached) return cached.streams;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const request = this.limiter
      .schedule(() => this.fetchStreams(base, query))
      .then((streams) => {
        this.cache.set(key, streams);
        return streams;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
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
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw timedOut
        ? this.unavailable(`no answer within ${Math.round(this.timeoutMs / 1000)} s`, 'The gateway is slow or stuck. Try again in a minute.')
        : this.unavailable('connection failed');
    }

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        throw this.unavailable('HTTP 429 (rate limited)', 'The gateway is rate limiting requests. Wait a few seconds and try again.');
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
