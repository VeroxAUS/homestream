import { describe, expect, it } from 'vitest';
import { RateMeter } from '../../src/network/rateMeter.js';

describe('RateMeter', () => {
  it('is zero when nothing was added', () => {
    expect(new RateMeter().mbps(5000, 10_000)).toBe(0);
  });

  it('reads a steady 8 Mbps over a 5 s window', () => {
    const meter = new RateMeter();
    // 1,000,000 bytes per second, added every 100 ms from t=0 to t=10 s.
    for (let t = 0; t < 10_000; t += 100) meter.add(100_000, t);
    expect(meter.mbps(5000, 9_999)).toBeCloseTo(8, 0);
    expect(meter.totalBytes).toBe(10_000_000);
  });

  it('forgets bytes that fell out of the window', () => {
    const meter = new RateMeter();
    meter.add(5_000_000, 1000);
    expect(meter.mbps(5000, 2000)).toBeGreaterThan(5);
    expect(meter.mbps(5000, 10_000)).toBe(0);
    expect(meter.totalBytes).toBe(5_000_000);
  });

  it('reuses its slots after a long time without mixing in old bytes', () => {
    const meter = new RateMeter();
    meter.add(1_000_000, 0);
    meter.add(2_000_000, 80 * 250);
    expect(meter.bytesIn(1000, 80 * 250)).toBe(2_000_000);
  });
});
