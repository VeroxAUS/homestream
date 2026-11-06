/**
 * Token bucket on an explicit clock. Tokens are bytes. A take may overdraw the bucket (a chunk is never split), and the
 * overdraft is paid back before the next take is allowed, so the long-run rate is exact.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    readonly bytesPerSec: number,
    /** How many bytes can be taken at once after an idle spell. */
    readonly depthBytes: number,
    nowMs: number,
  ) {
    this.tokens = depthBytes;
    this.last = nowMs;
  }

  private refill(nowMs: number): void {
    if (nowMs > this.last) {
      this.tokens = Math.min(this.depthBytes, this.tokens + ((nowMs - this.last) * this.bytesPerSec) / 1000);
      this.last = nowMs;
    }
  }

  /** True when a take would be allowed right now. */
  canTake(nowMs: number): boolean {
    this.refill(nowMs);
    return this.tokens >= 0;
  }

  take(bytes: number, nowMs: number): void {
    this.refill(nowMs);
    this.tokens -= bytes;
  }

  /** Milliseconds until the next take is allowed (0 when it is allowed now). */
  msUntilAvailable(nowMs: number): number {
    this.refill(nowMs);
    return this.tokens >= 0 ? 0 : (-this.tokens * 1000) / this.bytesPerSec;
  }
}
