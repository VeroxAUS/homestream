import type { IncomingMessage } from 'node:http';
import { existsSync, statSync } from 'node:fs';
import { AppError } from '../errors.js';
import type { ProbeResult } from '../playback/probe.js';
import type { UrlResolver } from '../playback/resolveUrl.js';
import type { Block, BlockOwner } from './blockCache.js';
import type {
  UpstreamClient} from './upstream.js';
import {
  isAbort,
  needsNewLink,
  rangeInfo,
  readInto,
  UpstreamNetworkError,
  UpstreamStatusError,
} from './upstream.js';

export const HEAD_BYTES = 16 * 1024 * 1024;
export const TAIL_BYTES = 8 * 1024 * 1024;
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 250;

/** `extractor` reads are paced to the entry's `extractorLimit`. */
export type Consumer = 'main' | 'extractor';

export interface SourceEntryDeps {
  upstream: UpstreamClient;
  resolve: UrlResolver;
  onRefresh: () => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unavailable(): AppError {
  return new AppError(
    502,
    'stream_unavailable',
    'Could not open the selected stream.',
    'Pick another stream (a cached ⚡ one is fastest), or check the TorBox account on the health dashboard.',
  );
}

/**
 * One resolved stream: its current upstream location and everything kept in memory for it. A source is a remote HTTP(S)
 * resource, or a plain file path (tests and local files), which needs no caching.
 */
export class SourceEntry implements BlockOwner {
  readonly blocks = new Map<number, Block>();
  blockBytes = 0;
  playheadByte = 0;
  /** Upstream bytes per second extractor reads may use; null is unlimited. */
  extractorLimit: number | null = null;
  lastUsed = Date.now();
  readonly refs = new Set<string>();
  /** Opaque ids in the loopback URL; the extractor one marks its reads as low priority. */
  readonly keys: Record<Consumer, string>;

  size = 0;
  contentType = 'application/octet-stream';
  /** Buffers are allocated once the size is known and fill from the front; only the first `headFilled`/`tailFilled` bytes are valid. */
  head: Buffer | null = null;
  headFilled = 0;
  tail: Buffer | null = null;
  tailFilled = 0;
  tailStart = 0;
  headTarget = 0;
  headSettled = true;
  tailSettled = true;
  /** Settles when the size is known; head and tail settle when their download has finished or failed. */
  ready: Promise<void> = Promise.resolve();
  headReady: Promise<void> = Promise.resolve();
  tailReady: Promise<void> = Promise.resolve();
  probe: Promise<ProbeResult> | null = null;
  closed = false;

  private generation = 0;
  private refreshing: Promise<void> | null = null;
  private cdnUrl: string;
  private readonly local: boolean;

  constructor(
    readonly rawUrl: string,
    resolvedUrl: string,
    keys: Record<Consumer, string>,
    private readonly deps: SourceEntryDeps,
  ) {
    this.cdnUrl = resolvedUrl;
    this.keys = keys;
    this.local = !/^https?:\/\//i.test(resolvedUrl);
  }

  get isLocal(): boolean {
    return this.local;
  }

  /** The location to read from for plain files; remote sources never expose theirs. */
  get filePath(): string {
    return this.cdnUrl;
  }

  touch(): void {
    this.lastUsed = Date.now();
  }

  private readonly fillWaiters: Array<{ done: () => boolean; resolve: () => void }> = [];

  /** Resolves once the head download has produced byte `pos`, or has stopped. */
  headHas(pos: number): Promise<void> {
    return this.waitFor(() => this.headSettled || pos < this.headFilled);
  }

  /** Resolves once the tail download has produced byte `pos` (or `pos` lies before the tail), or has stopped. */
  tailHas(pos: number): Promise<void> {
    return this.waitFor(() => this.tailSettled || (this.tail !== null && (pos < this.tailStart || pos - this.tailStart < this.tailFilled)));
  }

  private waitFor(done: () => boolean): Promise<void> {
    if (done()) return Promise.resolve();
    return new Promise<void>((resolve) => this.fillWaiters.push({ done, resolve }));
  }

  private notifyFill(): void {
    for (let i = this.fillWaiters.length - 1; i >= 0; i -= 1) {
      const waiter = this.fillWaiters[i];
      if (waiter?.done()) {
        this.fillWaiters.splice(i, 1);
        waiter.resolve();
      }
    }
  }

  /** Drops the cached bytes and releases anyone still waiting for them. */
  clearRegions(): void {
    this.head = null;
    this.tail = null;
    this.headFilled = 0;
    this.tailFilled = 0;
    this.headSettled = true;
    this.tailSettled = true;
    this.notifyFill();
  }

  /** Learns the size and starts filling head and tail in parallel. Settles once the size is known. */
  warm(): Promise<void> {
    if (this.local) {
      // A missing file is not an error here: reading it yields nothing and the probe reports the failure.
      this.size = existsSync(this.cdnUrl) ? statSync(this.cdnUrl).size : 0;
      this.ready = Promise.resolve();
      return this.ready;
    }

    let sizeKnown: () => void = () => undefined;
    let sizeFailed: (error: Error) => void = () => undefined;
    this.ready = new Promise<void>((resolve, reject) => {
      sizeKnown = resolve;
      sizeFailed = reject;
    });
    this.ready.catch(() => undefined);

    const learnSize = (total: number): void => {
      if (this.size === 0) {
        this.size = total;
        this.headTarget = Math.min(HEAD_BYTES, total);
      }
      sizeKnown();
    };

    this.headSettled = false;
    this.tailSettled = false;
    const head = this.open(`bytes=0-${HEAD_BYTES - 1}`).then(async (response) => {
      const info = rangeInfo(response);
      this.contentType = String(response.headers['content-type'] ?? this.contentType);
      if (!info?.total) {
        response.destroy();
        throw new Error('unknown size');
      }
      learnSize(info.total);
      const target = Buffer.allocUnsafe(Math.min(HEAD_BYTES, info.total));
      this.head = target;
      await readInto(response, target, (filled) => {
        if (this.closed) throw new Error('source released');
        this.headFilled = filled;
        this.notifyFill();
      });
    });
    const tail = this.open(`bytes=-${TAIL_BYTES}`).then(async (response) => {
      const info = rangeInfo(response);
      if (response.statusCode !== 206 || !info?.total) {
        // No suffix-range support: the head request alone decides the size and the tail is read on demand.
        response.destroy();
        return;
      }
      learnSize(info.total);
      const target = Buffer.allocUnsafe(Math.min(TAIL_BYTES, info.total - info.start));
      this.tailStart = info.start;
      this.tail = target;
      await readInto(response, target, (filled) => {
        if (this.closed) throw new Error('source released');
        this.tailFilled = filled;
        this.notifyFill();
      });
    });

    // Bytes that arrived before a failure stay servable, the rest is read on demand.
    this.headReady = head.catch(() => undefined).then(() => {
      this.headSettled = true;
      this.notifyFill();
    });
    this.tailReady = tail.catch(() => undefined).then(() => {
      this.tailSettled = true;
      this.notifyFill();
    });
    void Promise.allSettled([head, tail]).then(() => {
      if (this.size === 0) sizeFailed(unavailable());
    });
    return this.ready;
  }

  /** Opens a ranged read, re-resolving the CDN link on expiry and retrying transient failures. */
  async open(range: string, signal?: AbortSignal): Promise<IncomingMessage> {
    let refreshed = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const generation = this.generation;
      try {
        return await this.deps.upstream.request(this.cdnUrl, range, signal);
      } catch (error) {
        if (isAbort(error) || signal?.aborted) throw error;
        lastError = error;
        if (needsNewLink(error)) {
          if (refreshed) throw error;
          await this.refresh(generation).catch(() => undefined);
          refreshed = true;
          continue;
        }
        const transient = error instanceof UpstreamNetworkError || (error instanceof UpstreamStatusError && error.status >= 429);
        if (!transient) throw error;
        if (attempt >= 1 && !refreshed) {
          await this.refresh(generation).catch(() => undefined);
          refreshed = true;
        } else {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
        }
      }
    }
    throw lastError;
  }

  /**
   * Re-resolves the gateway link. A caller passes the generation it failed with, so several readers failing on the same
   * dead link cause one lookup.
   */
  refresh(seenGeneration = this.generation): Promise<void> {
    if (this.local || this.generation !== seenGeneration) return Promise.resolve();
    this.refreshing ??= this.deps
      .resolve(this.rawUrl)
      .then((url) => {
        this.cdnUrl = url;
        this.generation += 1;
        this.deps.onRefresh();
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
}
