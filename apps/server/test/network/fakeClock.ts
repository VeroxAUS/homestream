import type { Clock } from '../../src/network/downloadGate.js';

export class FakeClock implements Clock {
  time = 0;
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private nextId = 1;

  now(): number {
    return this.time;
  }

  setTimer(ms: number, fn: () => void): unknown {
    const id = this.nextId++;
    this.timers.push({ at: this.time + ms, fn, id });
    return id;
  }

  clearTimer(handle: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.setTimer(ms, resolve));
  }

  /** Runs due timers and the promise jobs they release, one millisecond at a time. */
  async advance(ms: number, onTick?: (now: number) => void): Promise<void> {
    const end = this.time + ms;
    while (this.time < end) {
      this.time += 1;
      for (const timer of this.timers.filter((item) => item.at <= this.time)) {
        this.timers = this.timers.filter((item) => item !== timer);
        timer.fn();
      }
      await Promise.resolve();
      onTick?.(this.time);
    }
  }
}
