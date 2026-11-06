import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../errors.js';
import type { ProbeResult, ProbeRunner } from '../playback/probe.js';
import type { UrlResolver } from '../playback/resolveUrl.js';
import { BlockCache, GLOBAL_CAP_BYTES, PER_SOURCE_CAP_BYTES, type BlockCacheStats } from './blockCache.js';
import { newCounters, serveSource, type ProxyCounters } from './serve.js';
import { SourceEntry, type Consumer } from './sourceEntry.js';
import { UpstreamClient } from './upstream.js';

export const LOOPBACK_HOST = '127.0.0.1';
export const PREFETCH_OWNER = 'prefetch';
export const PREFETCH_TTL_MS = 10 * 60 * 1000;
/** Prefetches nobody has played yet; the oldest is dropped beyond this. */
export const MAX_PREFETCH_ENTRIES = 3;
const SWEEP_INTERVAL_MS = 30_000;
const KEY_PATTERN = /^\/src\/([A-Za-z0-9_-]{8,64})$/;

export interface SourceProxyOptions {
  resolveUrl: UrlResolver;
  probe: ProbeRunner;
  /** 0 picks a free port. */
  port: number;
  logger: FastifyBaseLogger;
  globalCapBytes?: number;
  perSourceCapBytes?: number;
  prefetchTtlMs?: number;
  maxPrefetchEntries?: number;
  sweepIntervalMs?: number;
}

/** What a session or prefetch holds on to: loopback URLs for ffprobe/ffmpeg plus the cached probe and playback hints. */
export interface SourceHandle {
  /** For ffprobe and the encoder. */
  readonly url: string;
  /** For subtitle extractors: same bytes, paced to the limit set with `setExtractorLimit`. */
  readonly extractorUrl: string;
  /** ffprobe result for this source, run at most once and shared by every restart and later session. */
  probe(): Promise<ProbeResult>;
  /** Re-resolves the gateway link now (a real failure, as opposed to the automatic re-resolve on expiry). */
  refresh(): Promise<void>;
  /** Player position as a fraction of the duration; blocks well behind it are evicted first. */
  setPlayhead(fraction: number): void;
  /** Caps the upstream bytes per second the extractor URL may read (null: unlimited); the encoder URL is never capped. */
  setExtractorLimit(bytesPerSec: number | null): void;
  /** Size of the source file in bytes. */
  readonly sizeBytes: number;
  release(): void;
}

export interface SourceProxyStats extends ProxyCounters {
  sources: number;
  cache: BlockCacheStats;
}

function newKey(): string {
  return randomBytes(12).toString('base64url');
}

export class SourceProxy {
  private readonly entries = new Map<string, SourceEntry>();
  private readonly pending = new Map<string, Promise<SourceEntry>>();
  private readonly byKey = new Map<string, { entry: SourceEntry; consumer: Consumer }>();
  private readonly cache: BlockCache;
  private readonly upstream = new UpstreamClient();
  private readonly counters = newCounters();
  private readonly server: http.Server;
  private listening: Promise<number> | null = null;
  private sweeper: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly options: SourceProxyOptions) {
    this.cache = new BlockCache(options.globalCapBytes ?? GLOBAL_CAP_BYTES, options.perSourceCapBytes ?? PER_SOURCE_CAP_BYTES);
    this.server = http.createServer((req, res) => void this.handle(req, res));
    this.server.keepAliveTimeout = 60_000;
    this.server.requestTimeout = 0;
    this.server.on('clientError', (_error, socket) => socket.destroy());
  }

  /** Starts listening on loopback (once). Falls back to a free port when the wanted one is taken. */
  listen(): Promise<number> {
    this.listening ??= this.bind(this.options.port).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EADDRINUSE' || this.options.port === 0) throw error;
      this.options.logger.warn(`Source proxy port ${this.options.port} is in use; using a free port instead.`);
      return this.bind(0);
    });
    return this.listening;
  }

  private bind(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      this.server.once('error', onError);
      this.server.listen(port, LOOPBACK_HOST, () => {
        this.server.off('error', onError);
        this.sweeper = setInterval(() => this.sweep(), this.options.sweepIntervalMs ?? SWEEP_INTERVAL_MS);
        this.sweeper.unref();
        resolve((this.server.address() as AddressInfo).port);
      });
    });
  }

  get port(): number | null {
    const address = this.server.address();
    return address && typeof address === 'object' ? address.port : null;
  }

  /**
   * Registers (or joins) the source behind a gateway link. Resolves once the size is known; the head and tail keep loading in
   * the background. `owner` is a session id or `prefetch`.
   */
  async acquire(rawUrl: string, owner: string): Promise<SourceHandle> {
    if (this.closed) throw new AppError(503, 'shutting_down', 'The server is shutting down.', 'Try again in a moment.');
    const port = await this.listen();
    let entry = this.entries.get(rawUrl);
    if (!entry) {
      let pending = this.pending.get(rawUrl);
      if (!pending) {
        pending = this.create(rawUrl).finally(() => this.pending.delete(rawUrl));
        this.pending.set(rawUrl, pending);
      }
      entry = await pending;
    }
    if (entry.closed) return this.acquire(rawUrl, owner);
    entry.refs.add(owner);
    entry.touch();
    if (owner === PREFETCH_OWNER) this.trimPrefetches(entry);
    return this.handleFor(entry, owner, port);
  }

  stats(): SourceProxyStats {
    return { ...this.counters, sources: this.entries.size, cache: this.cache.stats() };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.sweeper) clearInterval(this.sweeper);
    for (const entry of [...this.entries.values()]) this.drop(entry);
    this.upstream.close();
    await new Promise<void>((resolve) => {
      if (!this.server.listening) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
      this.server.closeAllConnections();
    });
  }

  private async create(rawUrl: string): Promise<SourceEntry> {
    const resolved = await this.options.resolveUrl(rawUrl);
    const entry = new SourceEntry(rawUrl, resolved, { main: newKey(), extractor: newKey() }, {
      upstream: this.upstream,
      resolve: this.options.resolveUrl,
      onRefresh: () => {
        this.counters.linkRefreshes += 1;
        this.options.logger.info('Stream link refreshed after it stopped working');
      },
    });
    try {
      await entry.warm();
    } catch (error) {
      this.cache.drop(entry);
      throw error;
    }
    this.entries.set(rawUrl, entry);
    this.byKey.set(entry.keys.main, { entry, consumer: 'main' });
    this.byKey.set(entry.keys.extractor, { entry, consumer: 'extractor' });
    return entry;
  }

  private handleFor(entry: SourceEntry, owner: string, port: number): SourceHandle {
    const base = `http://${LOOPBACK_HOST}:${port}/src/`;
    let released = false;
    return {
      url: `${base}${entry.keys.main}`,
      extractorUrl: `${base}${entry.keys.extractor}`,
      probe: () => {
        entry.touch();
        entry.probe ??= this.options.probe(`${base}${entry.keys.main}`).catch((error: unknown) => {
          entry.probe = null;
          throw error;
        });
        return entry.probe;
      },
      refresh: () => entry.refresh(),
      setPlayhead: (fraction) => {
        entry.playheadByte = Math.max(0, Math.min(1, fraction)) * entry.size;
        entry.touch();
      },
      setExtractorLimit: (bytesPerSec) => {
        entry.extractorLimit = bytesPerSec;
      },
      sizeBytes: entry.size,
      release: () => {
        if (released) return;
        released = true;
        entry.refs.delete(owner);
        if (entry.refs.size === 0) this.drop(entry);
      },
    };
  }

  private drop(entry: SourceEntry): void {
    if (entry.closed) return;
    entry.closed = true;
    this.entries.delete(entry.rawUrl);
    this.byKey.delete(entry.keys.main);
    this.byKey.delete(entry.keys.extractor);
    this.cache.drop(entry);
    entry.clearRegions();
  }

  /** Keeps only the newest few prefetch-only sources; nobody may be playing the dropped ones. */
  private trimPrefetches(keep: SourceEntry): void {
    const idle = [...this.entries.values()].filter((entry) => entry.refs.size === 1 && entry.refs.has(PREFETCH_OWNER));
    const limit = this.options.maxPrefetchEntries ?? MAX_PREFETCH_ENTRIES;
    idle.sort((a, b) => a.lastUsed - b.lastUsed);
    while (idle.length > limit) {
      const oldest = idle.shift() as SourceEntry;
      if (oldest !== keep) this.drop(oldest);
    }
  }

  private sweep(): void {
    const ttl = this.options.prefetchTtlMs ?? PREFETCH_TTL_MS;
    const now = Date.now();
    for (const entry of [...this.entries.values()]) {
      if (!entry.refs.has(PREFETCH_OWNER) || now - entry.lastUsed < ttl) continue;
      entry.refs.delete(PREFETCH_OWNER);
      if (entry.refs.size === 0) this.drop(entry);
    }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const fail = (status: number): void => {
      if (!res.headersSent) res.writeHead(status, { 'Content-Length': 0 });
      res.end();
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405);
    const match = KEY_PATTERN.exec((req.url ?? '').split('?')[0] ?? '');
    const target = match ? this.byKey.get(match[1] as string) : undefined;
    if (!target) return fail(404);
    try {
      await serveSource(req, res, target.entry, target.consumer, this.cache, this.counters);
    } catch {
      if (!res.headersSent) fail(502);
      else res.destroy();
    }
  }
}
