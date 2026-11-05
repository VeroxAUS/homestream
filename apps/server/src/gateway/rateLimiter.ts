export interface RateLimiterOptions {
  maxRequests?: number;
  windowMs?: number;
  /** Extra spacing so jitter between dispatch and arrival cannot squeeze N+1 requests into one window. */
  marginMs?: number;
  now?: () => number;
}

interface Pending {
  start: () => void;
}

/** Sliding-window limiter: at most `maxRequests` task starts per `windowMs`, started in FIFO order. */
export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly marginMs: number;
  private readonly now: () => number;
  private readonly starts: number[] = [];
  private readonly queue: Pending[] = [];
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(options: RateLimiterOptions = {}) {
    this.maxRequests = options.maxRequests ?? 5;
    this.windowMs = options.windowMs ?? 5000;
    this.marginMs = options.marginMs ?? 150;
    this.now = options.now ?? Date.now;
  }

  get queued(): number {
    return this.queue.length;
  }

  schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.closed) {
        reject(new Error('Rate limiter is closed.'));
        return;
      }
      this.queue.push({
        start: () => {
          let running: Promise<T>;
          try {
            running = task();
          } catch (error) {
            reject(error);
            return;
          }
          running.then(resolve, reject);
        },
      });
      this.pump();
    });
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue.length = 0;
  }

  private pump(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const now = this.now();
    const horizon = now - this.windowMs - this.marginMs;
    while (this.starts.length > 0 && (this.starts[0] as number) <= horizon) this.starts.shift();

    while (this.queue.length > 0 && this.starts.length < this.maxRequests) {
      const next = this.queue.shift() as Pending;
      this.starts.push(now);
      next.start();
    }

    if (this.queue.length > 0) {
      const wait = Math.max(1, (this.starts[0] as number) + this.windowMs + this.marginMs - now);
      this.timer = setTimeout(() => this.pump(), wait);
    }
  }
}
