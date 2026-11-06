import { describe, expect, it } from 'vitest';
import { FALLING_BEHIND_AFTER_MS, FallingBehindWatch } from '../../src/playback/fallingBehind.js';

const filling = { speed: 0.6, readAhead: 'filling', idle: false } as const;

describe('FallingBehindWatch', () => {
  it('flags a session that is slower than real time for more than 30 s while filling', () => {
    const watch = new FallingBehindWatch();
    watch.observe('a', filling, 0);
    watch.observe('a', filling, FALLING_BEHIND_AFTER_MS);
    expect(watch.fallingBehind(FALLING_BEHIND_AFTER_MS)).toEqual([]);
    watch.observe('a', filling, FALLING_BEHIND_AFTER_MS + 1);
    expect(watch.fallingBehind(FALLING_BEHIND_AFTER_MS + 1)).toEqual(['a']);
  });

  it('never flags a session that waits at its read-ahead window, however slow its speed reads', () => {
    const watch = new FallingBehindWatch();
    for (let t = 0; t <= 600_000; t += 2000) watch.observe('a', { speed: 0.01, readAhead: 'waiting', idle: false }, t);
    expect(watch.fallingBehind(600_000)).toEqual([]);
  });

  it('starts a new streak after the window was waiting', () => {
    const watch = new FallingBehindWatch();
    watch.observe('a', filling, 0);
    watch.observe('a', { ...filling, readAhead: 'waiting' }, 20_000);
    watch.observe('a', filling, 40_000);
    expect(watch.fallingBehind(60_000)).toEqual([]);
    expect(watch.fallingBehind(71_000)).toEqual(['a']);
  });

  it('breaks the streak at real time or faster, at an unknown speed, and when the encoder is idle', () => {
    const watch = new FallingBehindWatch();
    watch.observe('a', filling, 0);
    watch.observe('a', { ...filling, speed: 1.0 }, 10_000);
    expect(watch.fallingBehind(60_000)).toEqual([]);

    watch.observe('b', filling, 0);
    watch.observe('b', { ...filling, speed: 0 }, 10_000);
    expect(watch.fallingBehind(60_000)).toEqual([]);

    watch.observe('c', filling, 0);
    watch.observe('c', { ...filling, idle: true }, 10_000);
    expect(watch.fallingBehind(60_000)).toEqual([]);
  });

  it('forgets a session', () => {
    const watch = new FallingBehindWatch();
    watch.observe('a', filling, 0);
    watch.forget('a');
    expect(watch.fallingBehind(100_000)).toEqual([]);
  });
});
