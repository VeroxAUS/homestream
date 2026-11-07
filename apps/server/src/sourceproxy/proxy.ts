import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../errors.js';
import { DownloadGate, atLeastExtractorShare } from '../network/downloadGate.js';
import { DEFAULT_MAX_DOWNLOAD_MBPS, DEFAULT_READ_AHEAD_RESUME_SEC, DEFAULT_READ_AHEAD_SEC } from '../network/limits.js';
import type { ReadAheadState } from '../network/readAhead.js';
import type { ProbeResult, ProbeRunner } from '../playback/probe.js';
import type { UrlResolver } from '../playback/resolveUrl.js';
import { BlockCache, GLOBAL_CAP_BYTES, PER_SOURCE_CAP_BYTES, type BlockCacheStats } from './blockCache.js';
import { newCounters, serveSource, type ProxyCounters } from './serve.js';
import { PREFETCH_OWNER, SourceEntry, type Consumer, type ReaderRef } from './sourceEntry.js';
import { UpstreamClient } from './upstream.js';

export { PREFETCH_OWNER };
const LOOPBACK_HOST = '127.0.0.1';
const PREFETCH_TTL_MS = 10 * 60 * 1000;
/** Prefetches nobody has played yet; the oldest is dropped beyond this. */
const MAX_PREFETCH_ENTRIES = 3;
const SWEEP_INTERVAL_MS = 30_000;
const KEY_PATTERN = /^\/src\/([A-Za-z0-9_-]{8,64})$/;
/** Query parameter naming the session (or prefetch) behind a loopback URL, so each gets its own read-ahead window. */
const OWNER_PARAM = 'o';
const OWNER_QUERY = /(?:^|&)o=([A-Za-z0-9_-]{8,64})(?:&|$)/;

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
  /** Cap on all upstream bytes together. */
  maxDownloadMbps?: number;
  /** Seconds of media an encoder may read ahead of the player, and the lead below which it reads again. */
  readAheadSec?: number;
  readAheadResumeSec?: number;
  /** Receives problems worth a log-view entry (a stream link that could not be refreshed). */
  onEvent?: (event: { level: 'warn' | 'error'; message: string }) => void;
}

/** What a session or prefetch holds on to: loopback URLs for ffprobe/ffmpeg plus the cached probe and playback hints. */
export interface SourceHandle {
  /** For ffprobe and the encoder. */
  readonly url: string;
  /** For subtitle extractors: same bytes, paced to the limit set with `setExtractorLimit`. */
  readonly extractorUrl: string;
  /** The extractor URL for one extractor run, so that run can be held at the end of the read-ahead window. */
  extractorRunUrl(runId: number): string;
  /** Holds or releases the reads of an extractor run (see `extractorRunUrl`). */
  setExtractorHold(runId: number, held: boolean): void;
  /** Seconds of encoded video ahead of the player; the encoder's reads stop at the read-ahead window and resume below the resume lead. */
  setLead(leadSec: number): void;
  /** Encoder start, seek or restart: the window is measured from here again. */
  resetReadAhead(): void;
  readonly readAhead: ReadAheadState;
  /** Settles when the head of the file has been downloaded (or the download stopped). */
  readonly headReady: Promise<void>;
  readonly leadSec: number;
  /** This source's own upstream download rate, Mbps, 5 s average. */
  rateMbps(): number;
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

export interface ProxyNetwork {
  /** All upstream downloads together, Mbps, 5 s average. */
  rateMbps: number;
  capMbps: number;
  readAheadSec: number;
  resumeSec: number;
  limitedForSec: number;
}

function newKey(): string {
  return randomBytes(12).toString('base64url');
}

export class SourceProxy {
  private readonly entries = new Map<string, SourceEntry>();
  private readonly pending = new Map<string, Promise<SourceEntry>>();
  private readonly byKey = new Map<string, { entry: SourceEntry; consumer: Consumer }>();
  private readonly cache: BlockCache;
  private readonly gate: DownloadGate;
  private readonly upstream = new UpstreamClient();
  private readonly counters = newCounters();
  private readonly server: http.Server;
  private listening: Promise<number> | null = null;
  private sweeper: NodeJS.Timeout | null = null;
  private closed = false;
  private lastRefreshFailureAt = 0;

  constructor(private readonly options: SourceProxyOptions) {
    this.cache = new BlockCache(
      options.globalCapBytes ?? GLOBAL_CAP_BYTES,
      options.perSourceCapBytes ?? PER_SOURCE_CAP_BYTES,
    );
    this.gate = new DownloadGate(options.maxDownloadMbps ?? DEFAULT_MAX_DOWNLOAD_MBPS);
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
   * the background. `owner` is a session id or `prefetch`. `resolvedUrl` is where the link already led when the caller
   * followed it; a new source starts from it instead of asking the gateway again (later refreshes still use `rawUrl`).
   */
  async acquire(rawUrl: string, owner: string, resolvedUrl?: string): Promise<SourceHandle> {
    if (this.closed) throw new AppError(503, 'shutting_down', 'The server is shutting down.', 'Try again in a moment.');
    const port = await this.listen();
    let entry = this.entries.get(rawUrl);
    if (!entry) {
      let pending = this.pending.get(rawUrl);
      if (!pending) {
        pending = this.create(rawUrl, owner, resolvedUrl).finally(() => this.pending.delete(rawUrl));
        this.pending.set(rawUrl, pending);
      }
      entry = await pending;
    }
    if (entry.closed) return this.acquire(rawUrl, owner, resolvedUrl);
    entry.refs.add(owner);
    entry.touch();
    if (owner === PREFETCH_OWNER) this.trimPrefetches(entry);
    return this.handleFor(entry, owner, port);
  }

  /** True while the source behind a gateway link is registered (held by a prefetch or a session) and not yet dropped. */
  isLive(rawUrl: string): boolean {
    const entry = this.entries.get(rawUrl);
    return entry !== undefined && !entry.closed;
  }

  stats(): SourceProxyStats {
    return { ...this.counters, sources: this.entries.size, cache: this.cache.stats() };
  }

  network(): ProxyNetwork {
    return {
      rateMbps: this.gate.mbps(5000),
      capMbps: this.gate.capMbps,
      readAheadSec: this.options.readAheadSec ?? DEFAULT_READ_AHEAD_SEC,
      resumeSec: this.options.readAheadResumeSec ?? DEFAULT_READ_AHEAD_RESUME_SEC,
      limitedForSec: this.gate.limitedForSec(),
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.sweeper) clearInterval(this.sweeper);
    this.gate.close();
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

  /** At most one entry per 30 s, however many readers hit the same dead link. */
  private reportRefreshFailure(): void {
    const now = Date.now();
    if (now - this.lastRefreshFailureAt < 30_000) return;
    this.lastRefreshFailureAt = now;
    const message = 'The stream link stopped working and could not be refreshed from the gateway.';
    this.options.logger.warn(message);
    this.options.onEvent?.({ level: 'error', message });
  }

  private async create(rawUrl: string, owner: string, resolvedUrl?: string): Promise<SourceEntry> {
    const resolved = resolvedUrl ?? (await this.options.resolveUrl(rawUrl));
    const entry = new SourceEntry(
      rawUrl,
      resolved,
      { main: newKey(), extractor: newKey() },
      {
        upstream: this.upstream,
        resolve: this.options.resolveUrl,
        onRefresh: () => {
          this.counters.linkRefreshes += 1;
          this.options.logger.info('Stream link refreshed after it stopped working');
        },
        onRefreshFailed: () => this.reportRefreshFailure(),
        gate: this.gate,
        readAheadSec: this.options.readAheadSec ?? DEFAULT_READ_AHEAD_SEC,
        resumeSec: this.options.readAheadResumeSec ?? DEFAULT_READ_AHEAD_RESUME_SEC,
        newToken: newKey,
        extractorLeadBytes: this.cache.perSourceBudgetBytes / 2,
      },
    );
    entry.firstOwner = owner;
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
    const token = entry.readerToken(owner);
    return {
      url: `${base}${entry.keys.main}?${OWNER_PARAM}=${token}`,
      extractorUrl: `${base}${entry.keys.extractor}`,
      extractorRunUrl: (runId) => `${base}${entry.keys.extractor}?${OWNER_PARAM}=${token}&run=${runId}`,
      setExtractorHold: (runId, held) => {
        if (!released) entry.setExtractorHold(owner, runId, held);
      },
      setLead: (leadSec) => {
        if (!released) entry.setLead(owner, leadSec);
      },
      resetReadAhead: () => {
        if (!released) entry.resetReadAhead(owner);
      },
      get readAhead() {
        return entry.readAheadOf(owner);
      },
      get headReady() {
        return entry.headReady;
      },
      get leadSec() {
        return entry.leadOf(owner);
      },
      rateMbps: () => entry.meter.mbps(5000, Date.now()),
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
        entry.extractorLimit = atLeastExtractorShare(bytesPerSec, this.gate.capMbps);
      },
      sizeBytes: entry.size,
      release: () => {
        if (released) return;
        released = true;
        entry.refs.delete(owner);
        entry.forgetOwner(owner);
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
    const [path = '', query = ''] = (req.url ?? '').split('?');
    const match = KEY_PATTERN.exec(path);
    const target = match ? this.byKey.get(match[1] as string) : undefined;
    if (!target) return fail(404);
    const run = /(?:^|&)run=(\d{1,9})(?:&|$)/.exec(query);
    const token = OWNER_QUERY.exec(query)?.[1];
    const reader: ReaderRef = {
      consumer: target.consumer,
      owner: token ? target.entry.ownerOf(token) : null,
      runId: run ? Number(run[1]) : null,
    };
    try {
      await serveSource(req, res, target.entry, reader, this.cache, this.counters);
    } catch {
      if (!res.headersSent) fail(502);
      else res.destroy();
    }
  }
}
