import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../../src/network/tokenBucket.js';

describe('TokenBucket', () => {
  it('starts full and allows one burst of its depth', () => {
    const bucket = new TokenBucket(1000, 500, 0);
    expect(bucket.canTake(0)).toBe(true);
    bucket.take(500, 0);
    expect(bucket.canTake(0)).toBe(true);
    bucket.take(1, 0);
    expect(bucket.canTake(0)).toBe(false);
  });

  it('refills at the rate and never above its depth', () => {
    const bucket = new TokenBucket(1000, 500, 0);
    bucket.take(500, 0);
    bucket.take(100, 0);
    expect(bucket.msUntilAvailable(0)).toBeCloseTo(100, 5);
    expect(bucket.canTake(99)).toBe(false);
    expect(bucket.canTake(100)).toBe(true);
    // A long idle spell does not bank more than the depth.
    bucket.take(0, 100_000);
    bucket.take(500, 100_000);
    bucket.take(1, 100_000);
    expect(bucket.canTake(100_000)).toBe(false);
  });

  it('pays back an overdraft before the next take, so the long-run rate is exact', () => {
    const rate = 1_000_000;
    const bucket = new TokenBucket(rate, 100_000, 0);
    let now = 0;
    let taken = 0;
    while (now < 20_000) {
      if (bucket.canTake(now)) {
        bucket.take(65_536, now);
        taken += 65_536;
      } else {
        now += Math.ceil(bucket.msUntilAvailable(now));
      }
    }
    // Everything taken up to 20 s fits the rate plus the depth and one chunk of overdraft.
    expect(taken).toBeLessThanOrEqual(rate * 20 + 100_000 + 65_536);
    expect(taken).toBeGreaterThanOrEqual(rate * 20 - 65_536);
  });
});
