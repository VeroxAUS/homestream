/**
 * Spreads reads over time so that, on average, no more than `bytesPerSec` pass. Delays are computed against a running
 * schedule instead of per chunk, because per-chunk sleeps of a few milliseconds are rounded up by the OS timer and would
 * undershoot the rate by half.
 */
export class RatePacer {
  private due = 0;

  /** Milliseconds to wait before passing `bytes`, given the current time. A rate of 0, Infinity or less means no waiting. */
  delayFor(bytes: number, bytesPerSec: number, nowMs: number): number {
    if (!(bytesPerSec > 0) || !Number.isFinite(bytesPerSec)) {
      this.due = nowMs;
      return 0;
    }
    // Idle time does not build credit: a read that resumes after a pause is paced from now on.
    this.due = Math.max(this.due, nowMs) + (bytes * 1000) / bytesPerSec;
    const wait = this.due - nowMs - MAX_BURST_MS;
    return wait > 0 ? wait : 0;
  }
}

/** A short burst ahead of the schedule is allowed so that timer granularity does not lower the average. */
const MAX_BURST_MS = 20;
