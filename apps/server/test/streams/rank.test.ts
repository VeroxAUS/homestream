import type { StreamOption } from '@homestream/shared';
import { describe, expect, it } from 'vitest';
import { deviceMaxRank, rankStreams, recommendStream } from '../../src/streams/rank.js';

let counter = 0;
function opt(overrides: Partial<StreamOption>): StreamOption {
  counter += 1;
  return {
    id: counter.toString(16).padStart(16, '0'),
    resolution: '1080p',
    videoCodec: 'h264',
    hdr: 'sdr',
    audio: 'AAC 2.0',
    source: 'WEB-DL',
    sizeBytes: 1,
    cached: true,
    filename: `f${counter}`,
    languages: [],
    label: '',
    ...overrides,
  };
}

const ids = (list: StreamOption[]) => list.map((item) => item.id);

describe('rankStreams', () => {
  it('orders by resolution desc, then source quality, then gateway order', () => {
    const a = opt({ resolution: '1080p', source: 'WEB-DL' });
    const b = opt({ resolution: '2160p', source: 'WEBRip' });
    const c = opt({ resolution: '1080p', source: 'Remux' });
    const d = opt({ resolution: '1080p', source: 'WEB-DL' });
    const e = opt({ resolution: 'unknown', source: 'Remux' });
    const f = opt({ resolution: '720p', source: 'HDTV' });
    const g = opt({ resolution: '1080p', source: 'Unknown' });
    const h = opt({ resolution: '1080p', source: 'BluRay' });
    const i = opt({ resolution: '480p', source: 'BluRay' });
    expect(ids(rankStreams([a, b, c, d, e, f, g, h, i]))).toEqual(ids([b, c, h, a, d, g, f, i, e]));
  });

  it('puts cached before uncached and hides uncached when anything is cached', () => {
    const cachedLow = opt({ resolution: '720p', cached: true });
    const uncachedHigh = opt({ resolution: '2160p', cached: false });
    expect(ids(rankStreams([uncachedHigh, cachedLow]))).toEqual(ids([cachedLow]));
  });

  it('returns uncached streams, ranked, when nothing is cached', () => {
    const a = opt({ resolution: '720p', cached: false });
    const b = opt({ resolution: '2160p', cached: false });
    expect(ids(rankStreams([a, b]))).toEqual(ids([b, a]));
  });

  it('handles an empty list', () => {
    expect(rankStreams([])).toEqual([]);
  });
});

describe('deviceMaxRank', () => {
  it.each([
    [3840, 2160, 4],
    [1920, 1080, 3],
    [1280, 720, 2],
    [854, 480, 1],
    [1920, 720, 2],
    [3840, 1080, 3],
  ])('%ix%i -> rank %i', (maxWidth, maxHeight, rank) => {
    expect(deviceMaxRank({ maxWidth, maxHeight })).toBe(rank);
  });
});

describe('recommendStream', () => {
  const s2160 = opt({ resolution: '2160p' });
  const s1080 = opt({ resolution: '1080p' });
  const s720 = opt({ resolution: '720p' });
  const s480 = opt({ resolution: '480p' });
  const sUnknown = opt({ resolution: 'unknown' });
  const ranked = [s2160, s1080, s720, s480, sUnknown];

  it('is the first ranked stream without a device limit', () => {
    expect(recommendStream(ranked, null)?.id).toBe(s2160.id);
  });

  it.each([
    [4, s2160],
    [3, s1080],
    [2, s720],
    [1, s480],
  ])('device rank %i picks the first stream that fits', (rank, expected) => {
    expect(recommendStream(ranked, rank)?.id).toBe(expected.id);
  });

  it('falls back to the first-ranked stream with the lowest resolution when none fits', () => {
    const first1080 = opt({ resolution: '1080p' });
    const second1080 = opt({ resolution: '1080p' });
    expect(recommendStream([s2160, first1080, second1080], 2)?.id).toBe(first1080.id);
    expect(recommendStream([s2160, first1080, second1080], 1)?.id).toBe(first1080.id);
  });

  it('treats unknown resolution as fitting any device', () => {
    expect(recommendStream([s2160, sUnknown], 2)?.id).toBe(sUnknown.id);
  });

  it('returns null for an empty list', () => {
    expect(recommendStream([], 3)).toBeNull();
  });
});
