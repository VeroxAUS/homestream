import { describe, expect, it } from 'vitest';
import {
  BURST_FLOOR_SPEED,
  encoderWarm,
  extractorLimit,
  HEAVY_BITRATE_BPS,
  isHeavySource,
  limitLabel,
  maxExtractorRuns,
  STARVED_BYTES_PER_SEC,
  WARMUP_BYTES_PER_SEC,
  type EncoderView,
} from '../../src/playback/extractorSchedule.js';

const GB = 1024 ** 3;

const encoder = (over: Partial<EncoderView> = {}): EncoderView => ({
  done: false,
  startSegment: 150,
  headSegment: 150,
  playerSegment: 150,
  speed: 0,
  recentSpeed: 0,
  ...over,
});

describe('isHeavySource', () => {
  it.each([
    { name: '2160p remux', height: 2160, sizeBytes: 69 * GB, durationSec: 9400, heavy: true },
    { name: '2160p with unknown size', height: 2160, sizeBytes: null, durationSec: 9400, heavy: true },
    { name: '1080p remux (~26 Mbps)', height: 1080, sizeBytes: 31 * GB, durationSec: 9400, heavy: false },
    { name: '1080p WebRip', height: 1080, sizeBytes: 4 * GB, durationSec: 7200, heavy: false },
    { name: '1080p at a very high bitrate', height: 1080, sizeBytes: 60 * GB, durationSec: 7200, heavy: true },
    { name: 'unknown size at 1080p', height: 1080, sizeBytes: 0, durationSec: 7200, heavy: false },
    { name: 'zero duration', height: 1080, sizeBytes: 10 * GB, durationSec: 0, heavy: false },
  ])('$name', ({ heavy, ...source }) => {
    expect(isHeavySource(source)).toBe(heavy);
  });

  it('switches exactly at the bitrate threshold', () => {
    const duration = 1000;
    const atLimit = (HEAVY_BITRATE_BPS * duration) / 8;
    expect(isHeavySource({ height: 1080, sizeBytes: atLimit, durationSec: duration })).toBe(true);
    expect(isHeavySource({ height: 1080, sizeBytes: atLimit - 1, durationSec: duration })).toBe(false);
  });
});

describe('maxExtractorRuns', () => {
  it('allows one extractor at a time for heavy sources and two otherwise', () => {
    expect(maxExtractorRuns(true)).toBe(1);
    expect(maxExtractorRuns(false)).toBe(2);
  });
});

describe('encoderWarm', () => {
  it('is cold at the start and while the head is less than 10 segments past the start', () => {
    expect(encoderWarm(encoder())).toBe(false);
    expect(encoderWarm(encoder({ headSegment: 159 }))).toBe(false);
  });

  it('is warm once the head is 10 segments past the start segment', () => {
    expect(encoderWarm(encoder({ headSegment: 160 }))).toBe(true);
  });

  it('is warm at 2x or more only after a few segments exist', () => {
    expect(encoderWarm(encoder({ headSegment: 151, recentSpeed: 4 }))).toBe(false);
    expect(encoderWarm(encoder({ headSegment: 153, recentSpeed: 2 }))).toBe(true);
    expect(encoderWarm(encoder({ headSegment: 153, speed: 2.4 }))).toBe(true);
    expect(encoderWarm(encoder({ headSegment: 153, recentSpeed: 1.9 }))).toBe(false);
  });

  it('prefers the recent speed over the run average', () => {
    expect(encoderWarm(encoder({ headSegment: 155, speed: 3, recentSpeed: 1.2 }))).toBe(false);
  });

  it('is warm when the encoder has finished', () => {
    expect(encoderWarm(encoder({ done: true }))).toBe(true);
  });
});

describe('extractorLimit', () => {
  const lead = (segments: number, over: Partial<EncoderView> = {}) =>
    encoder({ headSegment: 150 + segments, playerSegment: 150, ...over });

  describe('heavy source', () => {
    it('holds a fresh extractor to the warm-up rate even in its burst, so the first segments are not starved', () => {
      expect(extractorLimit({ heavy: true, bursting: true, encoder: encoder() })).toBe(WARMUP_BYTES_PER_SEC);
      expect(extractorLimit({ heavy: true, bursting: true, encoder: lead(5, { speed: 1.8 }) })).toBe(
        WARMUP_BYTES_PER_SEC,
      );
      expect(extractorLimit({ heavy: true, bursting: false, encoder: lead(5, { speed: 1.8 }) })).toBe(
        WARMUP_BYTES_PER_SEC,
      );
    });

    it('lets the burst run free once the encoder is warm and fast enough', () => {
      expect(extractorLimit({ heavy: true, bursting: true, encoder: lead(10, { speed: 2.4 }) })).toBeNull();
      expect(
        extractorLimit({ heavy: true, bursting: true, encoder: lead(4, { speed: 2.4, recentSpeed: 2.5 }) }),
      ).toBeNull();
    });

    it('still backs off to the starved rate when a warm encoder slows below the burst floor', () => {
      expect(
        extractorLimit({ heavy: true, bursting: true, encoder: lead(12, { speed: BURST_FLOOR_SPEED - 0.1 }) }),
      ).toBe(STARVED_BYTES_PER_SEC);
    });

    it('uses the normal lead and speed rules after the burst', () => {
      expect(extractorLimit({ heavy: true, bursting: false, encoder: lead(12, { speed: 2.4 }) })).toBeNull();
      expect(extractorLimit({ heavy: true, bursting: false, encoder: lead(12, { speed: 1.5 }) })).toBe(
        STARVED_BYTES_PER_SEC,
      );
    });

    it('does not limit once the encoder is done', () => {
      expect(extractorLimit({ heavy: true, bursting: true, encoder: encoder({ done: true }) })).toBeNull();
    });

    it('applies the warm-up again for an encoder restarted at a new start segment', () => {
      const restarted = encoder({ startSegment: 900, headSegment: 901, playerSegment: 900, speed: 2.5 });
      expect(extractorLimit({ heavy: true, bursting: true, encoder: restarted })).toBe(WARMUP_BYTES_PER_SEC);
    });
  });

  describe('light source keeps the existing behaviour', () => {
    it('a burst is unlimited from the first second, until the average speed nears the floor', () => {
      expect(extractorLimit({ heavy: false, bursting: true, encoder: encoder() })).toBeNull();
      expect(extractorLimit({ heavy: false, bursting: true, encoder: lead(1, { speed: 1.4 }) })).toBeNull();
      expect(extractorLimit({ heavy: false, bursting: true, encoder: lead(1, { speed: 1.3 }) })).toBe(
        STARVED_BYTES_PER_SEC,
      );
    });

    it('without a burst the extractor needs 30 s of lead and 1.6x', () => {
      expect(extractorLimit({ heavy: false, bursting: false, encoder: lead(7, { speed: 3 }) })).toBe(
        STARVED_BYTES_PER_SEC,
      );
      expect(extractorLimit({ heavy: false, bursting: false, encoder: lead(8, { speed: 3 }) })).toBeNull();
      expect(extractorLimit({ heavy: false, bursting: false, encoder: lead(8, { speed: 1.59 }) })).toBe(
        STARVED_BYTES_PER_SEC,
      );
      expect(extractorLimit({ heavy: false, bursting: false, encoder: lead(8, { speed: 3, recentSpeed: 1.5 }) })).toBe(
        STARVED_BYTES_PER_SEC,
      );
      expect(extractorLimit({ heavy: false, bursting: false, encoder: lead(8) })).toBeNull();
    });

    it('is not limited by a slow start of a 1080p encoder', () => {
      expect(extractorLimit({ heavy: false, bursting: true, encoder: lead(2, { speed: 0 }) })).toBeNull();
    });
  });

  it('names the limits for the log', () => {
    expect(limitLabel(null)).toBe('unlimited');
    expect(limitLabel(WARMUP_BYTES_PER_SEC)).toBe('warmup');
    expect(limitLabel(STARVED_BYTES_PER_SEC)).toBe('starved');
  });
});
