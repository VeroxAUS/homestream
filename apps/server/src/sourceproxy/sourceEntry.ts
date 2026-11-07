import type { IncomingMessage } from 'node:http';
import { existsSync, statSync } from 'node:fs';
import { AppError } from '../errors.js';
import type { ProbeResult } from '../playback/probe.js';
import { placeholderError } from '../playback/placeholder.js';
import type { UrlResolver } from '../playback/resolveUrl.js';
import {
  RANK_ENCODER,
  RANK_EXTRACTOR,
  RANK_PREFETCH,
  type DownloadGate,
  type Priority,
} from '../network/downloadGate.js';
import { RateMeter } from '../network/rateMeter.js';
import { encoderWindowSec, type ReadAheadState } from '../network/readAhead.js';
import { BLOCK_SIZE, type Block, type BlockOwner } from './blockCache.js';
import { ExtractorLeadBound } from './leadBound.js';
import { ReaderHolds } from './readerHolds.js';
import type { UpstreamClient } from './upstream.js';
import {
  isAbort,
  needsNewLink,
  rangeInfo,
  readInto,
  UpstreamNetworkError,
  UpstreamPlaceholderError,
  UpstreamStatusError,
} from './upstream.js';

/** Owner id of the prefetch holder of a source; sessions use their session id. */
export const PREFETCH_OWNER = 'prefetch';
export const HEAD_BYTES = 16 * 1024 * 1024;
export const TAIL_BYTES = 8 * 1024 * 1024;
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 250;
/** An extractor needing bytes this close ahead of an encoder stream waits for that stream to bring them (about a second at 60 Mbps). */
const SHARE_AHEAD_BYTES = 8 * 1024 * 1024;
/** A held extractor goes on once the gap is down to this share of the hold distance. */
const EXTRACTOR_LEAD_RESUME_FRACTION = 0.5;

/** `extractor` reads are paced to the entry's `extractorLimit`. */
export type Consumer = 'main' | 'extractor';

/** Who a loopback request belongs to: the consumer kind, the session (or prefetch) behind its URL token, and the extractor run. */
export interface ReaderRef {
  consumer: Consumer;
  owner: string | null;
  runId: number | null;
}

export interface SourceEntryDeps {
  upstream: UpstreamClient;
  resolve: UrlResolver;
  onRefresh: () => void;
  /** Called when re-resolving the gateway link failed (the readers then fail with the original error). */
  onRefreshFailed?: (error: unknown) => void;
  /** The shared cap on upstream bytes. */
  gate: DownloadGate;
  readAheadSec: number;
  resumeSec: number;
  /** Makes the opaque reader ids in loopback URLs. */
  newToken: () => string;
  /** How far past its session's encoder an extractor run may read before it is held (see `ExtractorLeadBound`). */
  extractorLeadBytes: number;
}

/**
 * An upstream stream being read for a consumer. A consumer that needs bytes just ahead of another one's position waits for
 * that stream to bring them instead of fetching them a second time.
 */
export interface Front {
  consumer: Consumer;
  /** First byte it was asked for. */
  begin: number;
  /** Next byte this stream will deliver. */
  pos: number;
  /** Last byte it was asked for. */
  end: number;
}

/** Head and tail warm-up reads happen before any owner is registered. */
const WARM_READER: ReaderRef = { consumer: 'main', owner: null, runId: null };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unavailable(): AppError {
  return new AppError(
    502,
    'stream_unavailable',
    'Could not open the selected stream.',
    'Try again in a moment. If it keeps failing, check the TorBox account on the health dashboard.',
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
  /** This source's own upstream download rate. */
  readonly meter = new RateMeter();
  /** Streams currently reading from upstream for a consumer. */
  readonly fronts = new Set<Front>();
  /** Who asked for this source first; its warm-up downloads happen before that owner is registered. */
  firstOwner: string | null = null;
  lastUsed = Date.now();
  readonly refs = new Set<string>();
  /** Opaque ids in the loopback URL; the extractor one marks its reads as low priority. */
  readonly keys: Record<Consumer, string>;
  /** Keeps a session's extractor within what the block cache holds ahead of that session's encoder. */
  readonly leadBound: ExtractorLeadBound;

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
  private readonly holds: ReaderHolds;
  private readonly holdWaiters = new Set<() => void>();

  constructor(
    readonly rawUrl: string,
    resolvedUrl: string,
    keys: Record<Consumer, string>,
    private readonly deps: SourceEntryDeps,
  ) {
    this.cdnUrl = resolvedUrl;
    this.keys = keys;
    this.local = !/^https?:\/\//i.test(resolvedUrl);
    this.holds = new ReaderHolds(encoderWindowSec(deps.readAheadSec), deps.resumeSec, deps.newToken, () =>
      this.wakeHolds(),
    );
    this.leadBound = new ExtractorLeadBound(
      deps.extractorLeadBytes,
      deps.extractorLeadBytes * EXTRACTOR_LEAD_RESUME_FRACTION,
      () => this.wakeHolds(),
    );
  }

  /** The smallest encoder lead of any owner: the one closest to running dry decides the bandwidth priority of shared reads. */
  get lead(): number {
    return this.holds.minLead();
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

  /** Opaque id for the loopback URLs of one owner; its reads are gated by that owner's own read-ahead window. */
  readerToken(owner: string): string {
    return this.holds.tokenFor(owner);
  }

  ownerOf(token: string): string | null {
    return this.holds.ownerOf(token);
  }

  readAheadOf(owner: string): ReadAheadState {
    return this.holds.stateOf(owner);
  }

  /**
   * Records one owner's encoder lead over its player. The byte cache is shared between the sessions playing a stream, but
   * each session's reader waits at its own window.
   */
  setLead(owner: string, leadSec: number): void {
    this.holds.setLead(owner, leadSec);
  }

  /** A start, seek or encoder restart: measured from here, so the next stretch downloads freely again. */
  resetReadAhead(owner: string): void {
    this.holds.reset(owner);
  }

  leadOf(owner: string): number {
    return this.holds.leadOf(owner);
  }

  forgetOwner(owner: string): void {
    this.holds.forget(owner);
    this.leadBound.forget(owner);
  }

  setExtractorHold(owner: string, runId: number, held: boolean): void {
    this.holds.setExtractorHold(owner, runId, held);
  }

  /** True when this reader must wait: it would fetch past the end of its owner's read-ahead window. Plain files never wait. */
  isHeld(reader: ReaderRef): boolean {
    if (this.local || this.closed) return false;
    return this.holds.isHeld(reader.consumer, reader.owner, reader.runId) || this.leadBound.isHeld(reader);
  }

  /** Resolves when `isHeld` may have changed, or `signal` aborts. */
  waitForRelease(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = (): void => {
        this.holdWaiters.delete(done);
        signal.removeEventListener('abort', done);
        resolve();
      };
      if (signal.aborted) {
        done();
        return;
      }
      this.holdWaiters.add(done);
      signal.addEventListener('abort', done, { once: true });
    });
  }

  private wakeHolds(): void {
    for (const wake of [...this.holdWaiters]) wake();
  }

  /** Another stream is about to deliver byte `pos`: it is just ahead of that stream's position. */
  streamApproaching(pos: number, self: Front | null): boolean {
    const blockStart = Math.floor(pos / BLOCK_SIZE) * BLOCK_SIZE;
    for (const front of this.fronts) {
      if (front === self || pos > front.end || blockStart < front.begin) continue;
      // The block holding `pos` lands in the cache once the stream has delivered its last byte.
      const ahead = front.pos <= pos && pos - front.pos <= SHARE_AHEAD_BYTES;
      const inProgress = front.pos > blockStart && front.pos <= blockStart + BLOCK_SIZE;
      if (ahead || inProgress) return true;
    }
    return false;
  }

  /** Counts downloaded bytes against the cap; resolves when they may be passed on. */
  async download(bytes: number, reader: ReaderRef, signal?: AbortSignal): Promise<void> {
    await this.deps.gate.acquire(bytes, () => this.priority(reader), signal);
    this.meter.add(bytes, Date.now());
  }

  private priority(reader: ReaderRef): Priority {
    if (reader.consumer === 'extractor') return { rank: RANK_EXTRACTOR, lead: this.lead };
    const prefetchOnly =
      this.refs.size > 0
        ? [...this.refs].every((owner) => owner === PREFETCH_OWNER)
        : this.firstOwner === PREFETCH_OWNER;
    const lead = reader.owner === null ? this.lead : this.leadOf(reader.owner);
    return { rank: prefetchOnly ? RANK_PREFETCH : RANK_ENCODER, lead };
  }

  private readonly fillWaiters: Array<{ done: () => boolean; resolve: () => void }> = [];

  /** Resolves once the head download has produced byte `pos`, or has stopped. */
  headHas(pos: number): Promise<void> {
    return this.waitFor(() => this.headSettled || pos < this.headFilled);
  }

  /** Resolves once the tail download has produced byte `pos` (or `pos` lies before the tail), or has stopped. */
  tailHas(pos: number): Promise<void> {
    return this.waitFor(
      () =>
        this.tailSettled || (this.tail !== null && (pos < this.tailStart || pos - this.tailStart < this.tailFilled)),
    );
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
    this.wakeHolds();
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
      await readInto(
        response,
        target,
        (filled) => {
          if (this.closed) throw new Error('source released');
          this.headFilled = filled;
          this.notifyFill();
        },
        (bytes) => this.download(bytes, WARM_READER),
      );
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
      await readInto(
        response,
        target,
        (filled) => {
          if (this.closed) throw new Error('source released');
          this.tailFilled = filled;
          this.notifyFill();
        },
        (bytes) => this.download(bytes, WARM_READER),
      );
    });

    let clip: string | null = null;
    const noteClip = (error: unknown): undefined => {
      if (error instanceof UpstreamPlaceholderError) clip ??= error.clip;
      return undefined;
    };
    // Bytes that arrived before a failure stay servable, the rest is read on demand.
    this.headReady = head.catch(noteClip).then(() => {
      this.headSettled = true;
      this.notifyFill();
    });
    this.tailReady = tail.catch(noteClip).then(() => {
      this.tailSettled = true;
      this.notifyFill();
    });
    void Promise.allSettled([head, tail]).then(() => {
      if (this.size === 0) sizeFailed(clip ? placeholderError(clip) : unavailable());
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
        const transient =
          error instanceof UpstreamNetworkError || (error instanceof UpstreamStatusError && error.status >= 429);
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
      .catch((error: unknown) => {
        this.deps.onRefreshFailed?.(error);
        throw error;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
}
