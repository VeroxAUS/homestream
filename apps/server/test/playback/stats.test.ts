import { describe, expect, it } from 'vitest';
import { bitrateKbpsFromSegments } from '../../src/playback/stats.js';

describe('bitrateKbpsFromSegments', () => {
  it.each([
    [[], 0],
    [[0, 0], 0],
    [[500_000], 1000],
    [[1_000_000, 3_000_000], 4000],
    [[2_500_000, 0, 2_500_000], 5000],
  ])('%j -> %d kbps for 4 s segments', (sizes, expected) => {
    expect(bitrateKbpsFromSegments(sizes)).toBe(expected);
  });

  it('honours a different segment length', () => {
    expect(bitrateKbpsFromSegments([1_000_000], 2)).toBe(4000);
  });
});
