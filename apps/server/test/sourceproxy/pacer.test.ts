import { describe, expect, it } from 'vitest';
import { RatePacer } from '../../src/sourceproxy/pacer.js';

const MB = 1024 * 1024;

/** Feeds `chunks` chunks of `size` bytes, sleeping as told, and returns the simulated elapsed ms. */
function simulate(rate: number, size: number, chunks: number, timerRoundMs = 0): number {
  const pacer = new RatePacer();
  let now = 1_000;
  for (let i = 0; i < chunks; i += 1) {
    const wait = pacer.delayFor(size, rate, now);
    // A sleep is rounded up to the timer tick, as setTimeout is on Windows.
    now += timerRoundMs > 0 && wait > 0 ? Math.ceil(wait / timerRoundMs) * timerRoundMs : wait;
  }
  return now - 1_000;
}

describe('RatePacer', () => {
  it('holds the average rate for small chunks', () => {
    const elapsed = simulate(6 * MB, 64 * 1024, 960);
    const rate = (960 * 64 * 1024) / (elapsed / 1000);
    expect(rate).toBeGreaterThan(5.8 * MB);
    expect(rate).toBeLessThan(6.2 * MB);
  });

  it('does not undershoot the rate when sleeps are rounded up to a 15.6 ms timer tick', () => {
    const elapsed = simulate(8 * MB, 64 * 1024, 1280, 15.6);
    const rate = (1280 * 64 * 1024) / (elapsed / 1000);
    expect(rate).toBeGreaterThan(7 * MB);
    expect(rate).toBeLessThan(8.3 * MB);
  });

  it('never waits without a limit', () => {
    const pacer = new RatePacer();
    for (const limit of [0, -1, Infinity, NaN]) expect(pacer.delayFor(MB, limit, 5_000)).toBe(0);
  });

  it('builds no credit while idle: a read after a pause is paced from then on', () => {
    const pacer = new RatePacer();
    pacer.delayFor(MB, 2 * MB, 0);
    const late = pacer.delayFor(2 * MB, 2 * MB, 60_000);
    expect(late).toBeGreaterThan(900);
    expect(late).toBeLessThan(1000);
  });

  it('follows a changed limit immediately', () => {
    const pacer = new RatePacer();
    let now = 0;
    for (let i = 0; i < 10; i += 1) now += pacer.delayFor(MB, 2 * MB, now);
    const slow = now;
    for (let i = 0; i < 10; i += 1) now += pacer.delayFor(MB, 10 * MB, now);
    expect(now - slow).toBeLessThan(slow / 3);
  });
});
