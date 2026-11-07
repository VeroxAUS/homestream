import type { StreamOption } from '@homestream/shared';
import { describe, expect, it } from 'vitest';
import {
  RESOLUTION_RANK,
  deviceMaxRank,
  rankStreams,
  recommendStream,
  startCandidates,
} from '../../src/streams/rank.js';

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
    expect(ids(rankStreams([a, b, c, d, e, f, g, h, i]))).toEqual(ids([b, a, d, h, c, g, f, i, e]));
  });

  it('ranks sources WEB-DL, BluRay, WEBRip, Remux, HDTV, unknown at the same resolution', () => {
    const sources = ['Unknown', 'HDTV', 'Remux', 'WEBRip', 'BluRay', 'WEB-DL'];
    const items = sources.map((source) => opt({ source }));
    expect(rankStreams(items).map((item) => item.source)).toEqual([
      'WEB-DL',
      'BluRay',
      'WEBRip',
      'Remux',
      'HDTV',
      'Unknown',
    ]);
  });

  it('matches the stub-gateway ordering of the validation contract', () => {
    const a = opt({ resolution: '1080p', source: 'Remux' });
    const b = opt({ resolution: '1080p', source: 'WEBRip' });
    const c = opt({ resolution: '1080p', source: 'WEB-DL' });
    const d = opt({ resolution: '2160p', source: 'WEB-DL' });
    const e = opt({ resolution: '1080p', source: 'BluRay' });
    const f = opt({ resolution: '1080p', source: 'HDTV' });
    const g = opt({ resolution: '1080p', source: 'WEB-DL' });
    const h = opt({ resolution: '720p', source: 'WEB-DL' });
    const i = opt({ resolution: '2160p', source: 'Remux' });
    const j = opt({ resolution: '2160p', source: 'WEB-DL', cached: false });
    const k = opt({ resolution: '1080p', source: 'WEB-DL', cached: false });
    const ranked = rankStreams([a, b, c, d, e, f, g, h, i, j, k]);
    expect(ids(ranked)).toEqual(ids([d, i, c, g, e, b, a, f, h]));
    expect(recommendStream(ranked, 5)?.id).toBe(d.id);
    expect(recommendStream(ranked, 3)?.id).toBe(c.id);
    expect(recommendStream(ranked, 2)?.id).toBe(h.id);
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
    [3840, 2160, 5],
    [3840, 1440, 5],
    [3840, 1080, 5],
    [4096, 1716, 5],
    [2560, 1440, 4],
    [2560, 1080, 4],
    [3200, 1440, 4],
    [1920, 1440, 4],
    [1920, 1080, 3],
    [2400, 1080, 3],
    [1920, 720, 3],
    [1280, 720, 2],
    [1280, 544, 2],
    [1024, 720, 2],
    [854, 480, 1],
    [640, 360, 1],
  ])('%ix%i -> rank %i', (maxWidth, maxHeight, rank) => {
    expect(deviceMaxRank({ maxWidth, maxHeight })).toBe(rank);
  });

  it.each([
    [1080, 2400, 3],
    [1440, 3200, 4],
    [1440, 3840, 5],
    [2160, 3840, 5],
    [720, 1280, 2],
    [1440, 1920, 4],
  ])('a portrait %ix%i profile gives the same rank as its landscape form (%i)', (maxWidth, maxHeight, rank) => {
    expect(deviceMaxRank({ maxWidth, maxHeight })).toBe(rank);
    expect(deviceMaxRank({ maxWidth: maxHeight, maxHeight: maxWidth })).toBe(rank);
  });
});

describe('startCandidates', () => {
  const w2160 = opt({ resolution: '2160p', source: 'WEB-DL' });
  const r2160 = opt({ resolution: '2160p', source: 'Remux' });
  const w1080 = opt({ resolution: '1080p', source: 'WEB-DL' });
  const b1080 = opt({ resolution: '1080p', source: 'BluRay' });
  const w720 = opt({ resolution: '720p', source: 'WEB-DL' });
  const u = opt({ resolution: 'unknown', source: 'Unknown' });
  const ranked = [w2160, r2160, w1080, b1080, w720, u];

  it('lists cached device-fitting streams in rank order, capped at the limit', () => {
    expect(ids(startCandidates(ranked, 5, 3).streams)).toEqual(ids([w2160, r2160, w1080]));
    expect(ids(startCandidates(ranked, 3, 3).streams)).toEqual(ids([w1080, b1080, w720]));
    expect(ids(startCandidates(ranked, null, 2).streams)).toEqual(ids([w2160, r2160]));
  });

  it('follows with the known streams above the device, lowest tier first, and unknown last', () => {
    expect(ids(startCandidates(ranked, 2, 9).streams)).toEqual(ids([w720, w1080, b1080, w2160, r2160, u]));
    expect(ids(startCandidates(ranked, 1, 9).streams)).toEqual(ids([w720, w1080, b1080, w2160, r2160, u]));
    expect(ids(startCandidates(ranked, 5, 9).streams)).toEqual(ids([w2160, r2160, w1080, b1080, w720, u]));
  });

  it('starts with the recommended stream', () => {
    for (const rank of [5, 4, 3, 2, 1, null]) {
      expect(startCandidates(ranked, rank, 3).streams[0]?.id).toBe(recommendStream(ranked, rank)?.id);
    }
  });

  it('falls back to the lowest resolution when nothing fits', () => {
    const only = [w2160, r2160, w1080];
    expect(ids(startCandidates(only, 2, 3).streams)).toEqual(ids([w1080, w2160, r2160]));
    expect(ids(startCandidates(only, 2, 1).streams)).toEqual(ids([w1080]));
  });

  it('keeps an unknown stream out of the first slot while any known cached stream exists', () => {
    const k2160 = opt({ resolution: '2160p' });
    const k1440 = opt({ resolution: '1440p' });
    const unknown = opt({ resolution: 'unknown' });
    const list = [k2160, k1440, unknown];
    expect(ids(startCandidates(list, 3, 3).streams)).toEqual(ids([k1440, k2160, unknown]));
    expect(ids(startCandidates(list, 3, 2).streams)).toEqual(ids([k1440, k2160]));
    expect(ids(startCandidates(list, null, 3).streams)).toEqual(ids([k2160, k1440, unknown]));
    expect(ids(startCandidates([unknown], 3, 3).streams)).toEqual(ids([unknown]));
  });

  it('offers only the recommended stream when nothing is cached', () => {
    const a = opt({ resolution: '2160p', cached: false });
    const b = opt({ resolution: '1080p', cached: false });
    expect(startCandidates([a, b], 3, 3)).toEqual({ streams: [b], cached: false });
    expect(startCandidates([], 3, 3)).toEqual({ streams: [], cached: false });
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
    [5, s2160],
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

  it('never lets unknown resolution beat a known stream, even one above the device', () => {
    expect(recommendStream([s2160, sUnknown], 2)?.id).toBe(s2160.id);
    expect(recommendStream([sUnknown, s2160], 2)?.id).toBe(s2160.id);
    expect(recommendStream([sUnknown, s2160], null)?.id).toBe(s2160.id);
    expect(recommendStream([sUnknown], 2)?.id).toBe(sUnknown.id);
    expect(recommendStream([sUnknown], null)?.id).toBe(sUnknown.id);
  });

  it('returns null for an empty list', () => {
    expect(recommendStream([], 3)).toBeNull();
  });
});

describe('1440p tier', () => {
  const s2160 = opt({ resolution: '2160p' });
  const s1440 = opt({ resolution: '1440p' });
  const s1080 = opt({ resolution: '1080p' });
  const s720 = opt({ resolution: '720p' });
  const sUnknown = opt({ resolution: 'unknown' });

  it('ranks 1440p between 1080p and 2160p, and unknown below every known resolution', () => {
    expect(ids(rankStreams([sUnknown, s720, s1080, s1440, s2160]))).toEqual(ids([s2160, s1440, s1080, s720, sUnknown]));
    expect(RESOLUTION_RANK['2160p']).toBeGreaterThan(RESOLUTION_RANK['1440p']);
    expect(RESOLUTION_RANK['1440p']).toBeGreaterThan(RESOLUTION_RANK['1080p']);
    expect(RESOLUTION_RANK['480p']).toBeGreaterThan(RESOLUTION_RANK.unknown);
  });

  it('is above a 1080p device and at or below a 2160p device', () => {
    const ranked = rankStreams([s2160, s1440, s1080, s720, sUnknown]);
    expect(recommendStream(ranked, deviceMaxRank({ maxWidth: 1920, maxHeight: 1080 }))?.id).toBe(s1080.id);
    expect(recommendStream(ranked, deviceMaxRank({ maxWidth: 2560, maxHeight: 1440 }))?.id).toBe(s1440.id);
    expect(recommendStream(ranked, deviceMaxRank({ maxWidth: 3840, maxHeight: 2160 }))?.id).toBe(s2160.id);
    expect(recommendStream(rankStreams([s1440, s1080]), deviceMaxRank({ maxWidth: 3840, maxHeight: 2160 }))?.id).toBe(
      s1440.id,
    );
  });

  it('never gives a 720p device a 1080p, 1440p or 2160p stream while a 720p-or-lower one exists', () => {
    const low480 = opt({ resolution: '480p' });
    const device = deviceMaxRank({ maxWidth: 1280, maxHeight: 720 });
    for (const lowest of [s720, low480]) {
      const ranked = rankStreams([sUnknown, s2160, s1440, s1080, lowest]);
      expect(recommendStream(ranked, device)?.id).toBe(lowest.id);
      expect(startCandidates(ranked, device, 5).streams.map((item) => item.resolution)).toEqual([
        lowest.resolution,
        '1080p',
        '1440p',
        '2160p',
        'unknown',
      ]);
    }
  });

  it('prefers a known fitting stream over an unknown one', () => {
    const ranked = rankStreams([sUnknown, s1440, s720]);
    expect(recommendStream(ranked, 2)?.id).toBe(s720.id);
    expect(startCandidates(ranked, 2, 1).streams[0]?.id).toBe(s720.id);
  });

  it('falls back to 1440p, not 2160p, when a 1080p device has nothing lower', () => {
    expect(recommendStream(rankStreams([s2160, s1440]), 3)?.id).toBe(s1440.id);
    expect(startCandidates(rankStreams([s2160, s1440]), 3, 3).streams.map((item) => item.id)).toEqual([
      s1440.id,
      s2160.id,
    ]);
  });

  it('picks 1440p, then 2160p, then unknown for cached [2160p, 1440p, unknown] on a 1080p device', () => {
    const ranked = rankStreams([s2160, s1440, sUnknown]);
    const device = deviceMaxRank({ maxWidth: 1920, maxHeight: 1080 });
    expect(recommendStream(ranked, device)?.id).toBe(s1440.id);
    expect(startCandidates(ranked, device, 3).streams.map((item) => item.id)).toEqual([
      s1440.id,
      s2160.id,
      sUnknown.id,
    ]);
  });
});
