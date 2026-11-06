import { mbpsToBytesPerSec } from './limits.js';
import { RateMeter } from './rateMeter.js';
import { TokenBucket } from './tokenBucket.js';

/** The bucket holds this much of the cap, so a 5 s window stays within a few percent of cap x 5 s. */
export const BUCKET_DEPTH_SEC = 0.2;
/** A request that has waited this long is served ahead of everything that has not, so low-priority readers are slowed, never starved. */
export const AGING_MS = 1500;
/** The cap counts as binding while some request was held back within this long. */
const LIMITED_GRACE_MS = 3000;
/** An encoder with less lead than this and a request held back by the cap is at risk of stalling its player. */
export const LOW_LEAD_SEC = 15;
/** An encoder with more lead than this can wait for the cap without its player noticing. */
export const HIGH_LEAD_SEC = 60;
/** The at-risk state outlasts the moment a request waits, because the reader asks again a few milliseconds after each grant. */
export const LOW_LEAD_MEMORY_MS = 200;
/** While an at-risk encoder is waiting, other encoders get only tokens beyond this much of the cap (seconds), which covers the reader's gap between a grant and its next request. */
export const SURPLUS_RESERVE_SEC = 0.05;

/** What other encoders may take while a session with a small lead is waiting. */
export interface Guard {
  /** The bucket holds more than the reserve, so the at-risk reader is not being outrun. */
  surplus: boolean;
}

/** Lower `rank` goes first; within a rank the smaller `lead` (seconds of video already buffered) goes first. */
export interface Priority {
  rank: number;
  lead: number;
}

export const RANK_ENCODER = 0;
export const RANK_PREFETCH = 1;
export const RANK_EXTRACTOR = 2;

export type PriorityInput = Priority | (() => Priority);

export interface Clock {
  now(): number;
  setTimer(ms: number, fn: () => void): unknown;
  clearTimer(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimer: (ms, fn) => {
    const handle = setTimeout(fn, ms);
    handle.unref();
    return handle;
  },
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

interface Waiter {
  bytes: number;
  priority: PriorityInput;
  since: number;
  seq: number;
  grant: () => void;
  onAbort: (() => void) | null;
  signal: AbortSignal | undefined;
}

function resolvePriority(input: PriorityInput): Priority {
  return typeof input === 'function' ? input() : input;
}

const isAtRisk = (priority: Priority): boolean => priority.rank === RANK_ENCODER && priority.lead < LOW_LEAD_SEC;

/** Encoders that are not at risk wait while one is: above HIGH_LEAD_SEC always, in between until the bucket has a surplus. */
function isHeldBack(priority: Priority, guard: Guard | null): boolean {
  if (!guard || priority.rank !== RANK_ENCODER || priority.lead < LOW_LEAD_SEC) return false;
  return priority.lead > HIGH_LEAD_SEC || !guard.surplus;
}

/**
 * Picks the waiter to serve next. Pure so the order can be tested without time passing. With a guard, encoders that
 * are not at risk of stalling are skipped, aging included, so the session about to stall gets the tokens first.
 */
export function pickNext<T extends { since: number; seq: number; priority: PriorityInput }>(waiters: readonly T[], nowMs: number, guard: Guard | null = null): T | undefined {
  let best: T | undefined;
  let bestKey: [number, number, number] = [0, 0, 0];
  for (const waiter of waiters) {
    const priority = resolvePriority(waiter.priority);
    if (isHeldBack(priority, guard)) continue;
    const aged = nowMs - waiter.since >= AGING_MS;
    const key: [number, number, number] = aged ? [-1, waiter.since, waiter.seq] : [priority.rank, priority.lead, waiter.seq];
    if (!best || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = waiter;
      bestKey = key;
    }
  }
  return best;
}

/**
 * The one shared limit on upstream (CDN) bytes. Every reader asks for the bytes it has just received before it passes them
 * on, which stops it reading from its socket until they are granted. Grants go to the highest priority waiter first.
 */
export class DownloadGate {
  readonly meter = new RateMeter();
  private readonly bucket: TokenBucket;
  private readonly reserveBytes: number;
  private readonly waiters: Waiter[] = [];
  private timer: unknown = null;
  private guardTimer = false;
  private seq = 0;
  private limitedSince: number | null = null;
  private lastLimited = 0;
  private atRiskAt = Number.NEGATIVE_INFINITY;

  constructor(
    readonly capMbps: number,
    private readonly clock: Clock = systemClock,
  ) {
    const rate = mbpsToBytesPerSec(capMbps);
    this.bucket = new TokenBucket(rate, rate * BUCKET_DEPTH_SEC, clock.now());
    this.reserveBytes = rate * SURPLUS_RESERVE_SEC;
  }

  get queued(): number {
    return this.waiters.length;
  }

  /** Resolves once `bytes` may count as downloaded. Resolves early, without counting, when `signal` aborts. */
  acquire(bytes: number, priority: PriorityInput, signal?: AbortSignal): Promise<void> {
    const now = this.clock.now();
    if (signal?.aborted) return Promise.resolve();
    const resolved = resolvePriority(priority);
    if (this.waiters.length === 0 && this.bucket.canTake(now) && !isHeldBack(resolved, this.guard(now))) {
      this.grantNow(bytes, now);
      return Promise.resolve();
    }
    this.markLimited(now);
    if (isAtRisk(resolved)) this.atRiskAt = now;
    return new Promise<void>((resolve) => {
      const waiter: Waiter = { bytes, priority, since: now, seq: (this.seq += 1), grant: resolve, onAbort: null, signal };
      if (signal) {
        waiter.onAbort = () => {
          const at = this.waiters.indexOf(waiter);
          if (at >= 0) this.waiters.splice(at, 1);
          resolve();
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
      this.schedule();
    });
  }

  /** Seconds the cap has been binding without a break (0 when it is not). */
  limitedForSec(nowMs = this.clock.now()): number {
    if (this.limitedSince === null || nowMs - this.lastLimited > LIMITED_GRACE_MS) return 0;
    return (nowMs - this.limitedSince) / 1000;
  }

  /** Upstream rate over the last `windowMs`, Mbps. */
  mbps(windowMs = 5000): number {
    return this.meter.mbps(windowMs, this.clock.now());
  }

  close(): void {
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    this.timer = null;
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.grant();
    }
  }

  private grantNow(bytes: number, now: number): void {
    this.bucket.take(bytes, now);
    this.meter.add(bytes, now);
  }

  private guard(now: number): Guard | null {
    if (now - this.atRiskAt > LOW_LEAD_MEMORY_MS) return null;
    return { surplus: this.bucket.canTake(now, this.reserveBytes) };
  }

  private markLimited(now: number): void {
    if (this.limitedSince === null || now - this.lastLimited > LIMITED_GRACE_MS) this.limitedSince = now;
    this.lastLimited = now;
  }

  private schedule(): void {
    // A timer waiting on tokens stays valid for a new waiter; one waiting for held back readers does not, because the new one may be servable now.
    if (this.timer !== null && !this.guardTimer) return;
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    this.pump();
  }

  private pump(): void {
    this.timer = null;
    this.guardTimer = false;
    for (;;) {
      const now = this.clock.now();
      if (this.waiters.length === 0) return;
      if (this.waiters.some((waiter) => isAtRisk(resolvePriority(waiter.priority)))) this.atRiskAt = now;
      if (!this.bucket.canTake(now)) {
        this.markLimited(now);
        this.timer = this.clock.setTimer(Math.max(1, Math.ceil(this.bucket.msUntilAvailable(now))), () => this.pump());
        return;
      }
      const guard = this.guard(now);
      const next = pickNext(this.waiters, now, guard);
      if (!next) {
        // Everyone waiting is held back for a session about to stall: look again when it has been quiet long enough or the reserve is full.
        const quiet = this.atRiskAt + LOW_LEAD_MEMORY_MS - now + 1;
        const wait = guard && !guard.surplus ? Math.min(quiet, Math.ceil(this.bucket.msUntilAvailable(now, this.reserveBytes))) : quiet;
        this.timer = this.clock.setTimer(Math.max(1, wait), () => this.pump());
        this.guardTimer = true;
        return;
      }
      this.waiters.splice(this.waiters.indexOf(next), 1);
      if (next.onAbort) next.signal?.removeEventListener('abort', next.onAbort);
      this.grantNow(next.bytes, now);
      next.grant();
    }
  }
}
