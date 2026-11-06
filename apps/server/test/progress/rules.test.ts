import { describe, expect, it } from 'vitest';
import { clampPosition, isCompleted, isResumable, MAX_PING_GAP_SEC, playingSecondsSince } from '../../src/progress/rules.js';

describe('completion rule', () => {
  it.each([
    [0.91, false],
    [0.9199, false],
    [0.92, true],
    [0.95, true],
    [1, true],
  ])('a %s share of a 7200 s title is completed=%s', (share, expected) => {
    expect(isCompleted(7200 * share, 7200)).toBe(expected);
  });

  it('has no fixed-time threshold: 15 minutes left on a 3 hour title is still incomplete', () => {
    expect(isCompleted(3 * 3600 - 900, 3 * 3600)).toBe(false);
  });

  it('survives float rounding at exactly 92 %', () => {
    for (const duration of [101, 119.7, 3599.9, 8423.456]) {
      expect(isCompleted(duration * 0.92, duration)).toBe(true);
    }
  });

  it('never completes an unknown duration', () => {
    expect(isCompleted(500, 0)).toBe(false);
  });
});

describe('resumable rule', () => {
  it.each([
    [0, false, false],
    [59.9, false, false],
    [60, false, true],
    [900, false, true],
    [900, true, false],
  ])('position %s, completed=%s -> resumable=%s', (position, completed, expected) => {
    expect(isResumable(position, completed)).toBe(expected);
  });
});

describe('clampPosition', () => {
  it('keeps the position inside 0..duration', () => {
    expect(clampPosition(-5, 100)).toBe(0);
    expect(clampPosition(130, 100)).toBe(100);
    expect(clampPosition(42, 100)).toBe(42);
    expect(clampPosition(Number.NaN, 100)).toBe(0);
  });
});

describe('playingSecondsSince', () => {
  it('credits the gap only when the previous ping said playing', () => {
    expect(playingSecondsSince('playing', 10_000)).toBe(10);
    expect(playingSecondsSince('paused', 10_000)).toBe(0);
    expect(playingSecondsSince('buffering', 10_000)).toBe(0);
    expect(playingSecondsSince(null, 10_000)).toBe(0);
  });

  it('caps one gap so a silent client cannot add minutes', () => {
    expect(playingSecondsSince('playing', 600_000)).toBe(MAX_PING_GAP_SEC);
  });

  it('ignores zero and negative gaps', () => {
    expect(playingSecondsSince('playing', 0)).toBe(0);
    expect(playingSecondsSince('playing', -50)).toBe(0);
  });

  it('sums a play/pause/play series to the playing time only', () => {
    const series: Array<[state: 'playing' | 'paused' | 'buffering', atSec: number]> = [
      ['playing', 10],
      ['playing', 20],
      ['paused', 30],
      ['paused', 40],
      ['playing', 50],
      ['playing', 60],
    ];
    let previous: 'playing' | 'paused' | 'buffering' | null = 'playing';
    let clock = 0;
    let watched = 0;
    for (const [state, atSec] of series) {
      watched += playingSecondsSince(previous, (atSec - clock) * 1000);
      previous = state;
      clock = atSec;
    }
    // 0-10, 10-20, 20-30 (paused at 30) are playing; 30-50 paused; 50-60 playing.
    expect(watched).toBe(40);
  });
});
