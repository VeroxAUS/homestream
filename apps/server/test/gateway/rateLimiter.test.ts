import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../src/gateway/rateLimiter.js';
import { maxArrivalsInWindow } from './stubGateway.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('RateLimiter', () => {
  it('starts up to maxRequests immediately and queues the rest in FIFO order', async () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 200, marginMs: 10 });
    const started: number[] = [];
    const t0 = performance.now();
    const results = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        limiter.schedule(async () => {
          started.push(i);
          return { i, at: performance.now() - t0 };
        }),
      ),
    );
    limiter.close();

    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(results.slice(0, 3).every((r) => r.at < 100)).toBe(true);
    expect(results[3]?.at).toBeGreaterThanOrEqual(190);
    expect(results[6]?.at).toBeGreaterThanOrEqual(390);
  });

  it('never allows more than maxRequests starts in any sliding window', async () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 150, marginMs: 10 });
    const times: number[] = [];
    await Promise.all(
      Array.from({ length: 17 }, () =>
        limiter.schedule(async () => {
          times.push(performance.now());
        }),
      ),
    );
    limiter.close();
    expect(times).toHaveLength(17);
    expect(maxArrivalsInWindow(times, 150)).toBeLessThanOrEqual(5);
  });

  it('keeps going after a task fails and counts the failed start', async () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60, marginMs: 5 });
    const failing = limiter.schedule(async () => {
      throw new Error('boom');
    });
    const next = limiter.schedule(async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
    limiter.close();
  });

  it('rejects new work once closed', async () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 50 });
    limiter.close();
    await expect(limiter.schedule(async () => 1)).rejects.toThrow(/closed/);
    await sleep(0);
  });
});
