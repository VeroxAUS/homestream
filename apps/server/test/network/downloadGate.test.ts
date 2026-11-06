import { describe, expect, it } from 'vitest';
import {
  AGING_MS,
  BUCKET_DEPTH_SEC,
  DownloadGate,
  RANK_ENCODER,
  RANK_EXTRACTOR,
  RANK_PREFETCH,
  pickNext,
  type Clock,
  type Priority,
} from '../../src/network/downloadGate.js';
import { mbpsToBytesPerSec } from '../../src/network/limits.js';

class FakeClock implements Clock {
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

  /** Runs due timers and the promise jobs they release, one millisecond at a time. */
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    while (this.time < end) {
      this.time += 1;
      for (const timer of this.timers.filter((item) => item.at <= this.time)) {
        this.timers = this.timers.filter((item) => item !== timer);
        timer.fn();
      }
      await Promise.resolve();
    }
  }
}

const encoder = (lead: number): Priority => ({ rank: RANK_ENCODER, lead });

describe('pickNext', () => {
  const waiter = (priority: Priority, since = 0, seq = 0) => ({ priority, since, seq });

  it('serves encoders before prefetch before extractors', () => {
    const waiters = [
      waiter({ rank: RANK_EXTRACTOR, lead: 0 }, 0, 1),
      waiter({ rank: RANK_PREFETCH, lead: 0 }, 0, 2),
      waiter({ rank: RANK_ENCODER, lead: 100 }, 0, 3),
    ];
    expect(pickNext(waiters, 0)?.seq).toBe(3);
  });

  it('serves the encoder with the smallest lead first, then arrival order', () => {
    const waiters = [waiter(encoder(90), 0, 1), waiter(encoder(10), 0, 2), waiter(encoder(10), 0, 3)];
    expect(pickNext(waiters, 0)?.seq).toBe(2);
  });

  it('reads the priority again at every pick', () => {
    let lead = 50;
    const live = { priority: () => encoder(lead), since: 0, seq: 1 };
    const fixed = waiter(encoder(20), 0, 2);
    expect(pickNext([live, fixed], 0)?.seq).toBe(2);
    lead = 5;
    expect(pickNext([live, fixed], 0)?.seq).toBe(1);
  });

  it('serves a request that waited past the aging time ahead of everything that has not', () => {
    const waiters = [waiter(encoder(0), 1000, 1), waiter({ rank: RANK_EXTRACTOR, lead: 0 }, 0, 2)];
    expect(pickNext(waiters, AGING_MS - 1)?.seq).toBe(1);
    expect(pickNext(waiters, AGING_MS)?.seq).toBe(2);
  });

  it('returns nothing for no waiters', () => {
    expect(pickNext([], 0)).toBeUndefined();
  });
});

describe('DownloadGate', () => {
  it('lets bytes through at once while the bucket is not empty', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(60, clock);
    let granted = false;
    void gate.acquire(1000, encoder(0)).then(() => {
      granted = true;
    });
    await Promise.resolve();
    expect(granted).toBe(true);
    expect(gate.queued).toBe(0);
  });

  it('never lets more than the cap through in any 5 s window, with several greedy readers', async () => {
    const clock = new FakeClock();
    const capMbps = 60;
    const gate = new DownloadGate(capMbps, clock);
    const log: Array<{ at: number; bytes: number }> = [];
    const reader = async (rank: number): Promise<void> => {
      for (;;) {
        await gate.acquire(65_536, { rank, lead: 0 });
        log.push({ at: clock.now(), bytes: 65_536 });
      }
    };
    void reader(RANK_ENCODER);
    void reader(RANK_ENCODER);
    void reader(RANK_EXTRACTOR);
    await clock.advance(30_000);

    const limit = mbpsToBytesPerSec(capMbps) * 5 * 1.05;
    let worst = 0;
    for (let start = 0; start <= 25_000; start += 250) {
      const sum = log.filter((entry) => entry.at >= start && entry.at < start + 5000).reduce((total, entry) => total + entry.bytes, 0);
      worst = Math.max(worst, sum);
    }
    expect(worst).toBeLessThanOrEqual(limit);
    // And it is actually used: the cap is reached, not merely respected.
    const steady = log.filter((entry) => entry.at >= 5000 && entry.at < 30_000).reduce((total, entry) => total + entry.bytes, 0);
    expect((steady * 8) / 1_000_000 / 25).toBeGreaterThan(capMbps * 0.97);
    expect(BUCKET_DEPTH_SEC).toBeLessThanOrEqual(0.2);
  });

  it('gives the cap first to the encoder with the smaller lead when it binds', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(10, clock);
    const bytes = { near: 0, far: 0, extractor: 0 };
    const reader = async (key: keyof typeof bytes, priority: Priority): Promise<void> => {
      for (;;) {
        await gate.acquire(16_384, priority);
        bytes[key] += 16_384;
      }
    };
    void reader('far', encoder(150));
    void reader('extractor', { rank: RANK_EXTRACTOR, lead: 0 });
    void reader('near', encoder(5));
    await clock.advance(3000);
    // Aging passes the low priority readers a share, but the near encoder is served first.
    expect(bytes.near).toBeGreaterThan(bytes.far);
    expect(bytes.near).toBeGreaterThan(bytes.extractor);
  });

  it('slows low priority readers without starving them', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(10, clock);
    let extractor = 0;
    const encoderLoop = async (): Promise<void> => {
      for (;;) await gate.acquire(16_384, encoder(0));
    };
    void encoderLoop();
    const extractorLoop = async (): Promise<void> => {
      for (;;) {
        await gate.acquire(16_384, { rank: RANK_EXTRACTOR, lead: 0 });
        extractor += 16_384;
      }
    };
    void extractorLoop();
    await clock.advance(10_000);
    expect(extractor).toBeGreaterThan(0);
  });

  it('measures its own rate and how long the cap has been binding', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(8, clock);
    expect(gate.limitedForSec()).toBe(0);
    const loop = async (): Promise<void> => {
      for (;;) await gate.acquire(10_000, encoder(0));
    };
    void loop();
    await clock.advance(12_000);
    expect(gate.mbps(5000)).toBeGreaterThan(7.5);
    expect(gate.mbps(5000)).toBeLessThan(8.4);
    expect(gate.limitedForSec()).toBeGreaterThan(10);
  });

  it('reports the cap as not binding once demand stops', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(8, clock);
    let stop = false;
    const loop = async (): Promise<void> => {
      while (!stop) await gate.acquire(10_000, encoder(0));
    };
    void loop();
    await clock.advance(6000);
    expect(gate.limitedForSec()).toBeGreaterThan(0);
    stop = true;
    await clock.advance(8000);
    expect(gate.limitedForSec()).toBe(0);
    expect(gate.mbps(5000)).toBeLessThan(0.1);
  });

  it('releases a waiting request when its signal aborts, without counting its bytes', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(5, clock);
    // Empty the bucket.
    await gate.acquire(1_000_000, encoder(0));
    const controller = new AbortController();
    let released = false;
    void gate.acquire(65_536, encoder(0), controller.signal).then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    expect(gate.queued).toBe(1);
    const before = gate.meter.totalBytes;
    controller.abort();
    await Promise.resolve();
    expect(released).toBe(true);
    expect(gate.queued).toBe(0);
    expect(gate.meter.totalBytes).toBe(before);
  });

  it('releases everything waiting when closed', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(5, clock);
    await gate.acquire(1_000_000, encoder(0));
    let released = 0;
    for (let i = 0; i < 3; i += 1) void gate.acquire(65_536, encoder(0)).then(() => (released += 1));
    await Promise.resolve();
    gate.close();
    await Promise.resolve();
    expect(released).toBe(3);
  });
});
