import { describe, expect, it } from 'vitest';
import {
  AGING_MS,
  DownloadGate,
  EXTRACTOR_SHARE,
  LOW_LEAD_SEC,
  RANK_ENCODER,
  RANK_EXTRACTOR,
  atLeastExtractorShare,
  extractorShareBytesPerSec,
  pickNext,
  type Priority,
} from '../../src/network/downloadGate.js';
import { mbpsToBytesPerSec } from '../../src/network/limits.js';
import { STARVED_BYTES_PER_SEC, WARMUP_BYTES_PER_SEC } from '../../src/playback/extractorSchedule.js';
import { FakeClock } from './fakeClock.js';

const CHUNK = 65_536;
const HEALTHY_LEAD = 40;

interface Grant {
  at: number;
  bytes: number;
  who: string;
}

/** Every reader asks again as soon as it is served, which is what a socket that always has data does. */
function rig(capMbps: number) {
  const clock = new FakeClock();
  const gate = new DownloadGate(capMbps, clock);
  const log: Grant[] = [];
  const reader = (who: string, priority: () => Priority, gapMs = 0): void => {
    void (async () => {
      for (;;) {
        await gate.acquire(CHUNK, priority);
        log.push({ at: clock.now(), bytes: CHUNK, who });
        if (gapMs > 0) await clock.sleep(gapMs);
      }
    })();
  };
  const mbps = (who: string | null, fromMs: number, toMs: number): number => {
    const bytes = log
      .filter((grant) => (who === null || grant.who === who) && grant.at >= fromMs && grant.at < toMs)
      .reduce((total, grant) => total + grant.bytes, 0);
    return (bytes * 8) / 1_000_000 / ((toMs - fromMs) / 1000);
  };
  const worstWindowBytes = (fromMs: number, toMs: number, windowMs = 5000): number => {
    let worst = 0;
    for (let start = fromMs; start + windowMs <= toMs; start += 250) {
      const sum = log
        .filter((grant) => grant.at >= start && grant.at < start + windowMs)
        .reduce((total, grant) => total + grant.bytes, 0);
      worst = Math.max(worst, sum);
    }
    return worst;
  };
  return { clock, gate, log, reader, mbps, worstWindowBytes };
}

const encoder = (lead: number): Priority => ({ rank: RANK_ENCODER, lead });
const extractor: Priority = { rank: RANK_EXTRACTOR, lead: 0 };

describe('EXTRACTOR_SHARE', () => {
  it('starts at 20% of the cap: 12 Mbps at 60 and 30 Mbps at 150', () => {
    expect(EXTRACTOR_SHARE).toBe(0.2);
    expect((extractorShareBytesPerSec(60) * 8) / 1_000_000).toBeCloseTo(12, 6);
    expect((extractorShareBytesPerSec(150) * 8) / 1_000_000).toBeCloseTo(30, 6);
    expect(extractorShareBytesPerSec(150)).toBeCloseTo(mbpsToBytesPerSec(150) * EXTRACTOR_SHARE, 6);
  });
});

describe('atLeastExtractorShare', () => {
  const MIB = 1024 * 1024;

  it('keeps unlimited reads unlimited', () => {
    expect(atLeastExtractorShare(null, 60)).toBeNull();
  });

  it('leaves a pacing rate that is above the share alone and lifts one that is below it', () => {
    // Cap 60: the share is 1.43 MiB/s, under the starved 2 MiB/s. Cap 150: 3.58 MiB/s, above it.
    expect(atLeastExtractorShare(STARVED_BYTES_PER_SEC, 60)).toBe(STARVED_BYTES_PER_SEC);
    expect(atLeastExtractorShare(STARVED_BYTES_PER_SEC, 150)).toBeCloseTo(extractorShareBytesPerSec(150), 6);
    expect(atLeastExtractorShare(STARVED_BYTES_PER_SEC, 150)! / MIB).toBeCloseTo(3.58, 2);
    expect(atLeastExtractorShare(WARMUP_BYTES_PER_SEC, 150)).toBe(WARMUP_BYTES_PER_SEC);
  });

  it.each([5, 20, 60, 150, 300, 600])(
    'never returns less than the share at cap %i Mbps, whatever fixed rate the schedule picks',
    (cap) => {
      for (const fixed of [STARVED_BYTES_PER_SEC, WARMUP_BYTES_PER_SEC, 1, 0]) {
        expect(atLeastExtractorShare(fixed, cap)!).toBeGreaterThanOrEqual(extractorShareBytesPerSec(cap));
      }
    },
  );
});

describe('pickNext with the extractor share', () => {
  const waiter = (priority: Priority, since = 0, seq = 0) => ({ priority, since, seq });

  it('serves a waiting extractor first while its share is ready and every encoder has a healthy lead', () => {
    const waiters = [waiter(encoder(LOW_LEAD_SEC), 0, 1), waiter(extractor, 0, 2)];
    expect(pickNext(waiters, 0, null, false)?.seq).toBe(1);
    expect(pickNext(waiters, 0, null, true)?.seq).toBe(2);
  });

  it('ignores the share while any waiting encoder is below the low lead', () => {
    const waiters = [waiter(encoder(LOW_LEAD_SEC - 0.1), 0, 1), waiter(encoder(90), 0, 2), waiter(extractor, 0, 3)];
    expect(pickNext(waiters, 0, null, true)?.seq).toBe(1);
  });

  it('never lets an aged extractor pass an encoder that is below the low lead', () => {
    const waiters = [waiter(encoder(0), AGING_MS, 1), waiter(extractor, 0, 2)];
    expect(pickNext(waiters, AGING_MS, null, false)?.seq).toBe(1);
    expect(pickNext(waiters, AGING_MS * 20, null, true)?.seq).toBe(1);
  });

  it('serves an aged extractor ahead of a healthy encoder, as before', () => {
    const waiters = [waiter(encoder(LOW_LEAD_SEC + 5), 1000, 1), waiter(extractor, 0, 2)];
    expect(pickNext(waiters, AGING_MS - 1, null, false)?.seq).toBe(1);
    expect(pickNext(waiters, AGING_MS, null, false)?.seq).toBe(2);
  });

  it('holds every extractor back while the guard says an at-risk encoder was waiting a moment ago', () => {
    expect(pickNext([waiter(extractor, 0, 1)], 10_000, { surplus: true }, true)).toBeUndefined();
    expect(pickNext([waiter(extractor, 0, 1)], 10_000, null, true)?.seq).toBe(1);
  });

  it('serves the extractor with the smallest lead among several', () => {
    const waiters = [
      waiter({ rank: RANK_EXTRACTOR, lead: 80 }, 0, 1),
      waiter({ rank: RANK_EXTRACTOR, lead: 20 }, 0, 2),
    ];
    expect(pickNext([...waiters, waiter(encoder(50), 0, 3)], 0, null, true)?.seq).toBe(2);
  });
});

describe('DownloadGate extractor share under a saturated cap', () => {
  it.each([
    { capMbps: 60, shareMbps: 12 },
    { capMbps: 150, shareMbps: 30 },
  ])(
    'gives greedy extractors at least $shareMbps Mbps at cap $capMbps while the encoder lead is healthy',
    async ({ capMbps, shareMbps }) => {
      const { clock, reader, mbps, worstWindowBytes } = rig(capMbps);
      reader('encoder', () => encoder(HEALTHY_LEAD));
      reader('extractor', () => extractor);
      await clock.advance(30_000);

      expect(mbps('extractor', 5000, 30_000)).toBeGreaterThanOrEqual(shareMbps * 0.95);
      // It is a minimum, not a way to take the link: the encoder keeps the rest.
      expect(mbps('extractor', 5000, 30_000)).toBeLessThanOrEqual(shareMbps * 1.25);
      expect(mbps('encoder', 5000, 30_000)).toBeGreaterThanOrEqual((capMbps - shareMbps) * 0.93);
      expect(worstWindowBytes(0, 30_000)).toBeLessThanOrEqual(mbpsToBytesPerSec(capMbps) * 5 * 1.05);
      expect(mbps(null, 5000, 30_000)).toBeGreaterThan(capMbps * 0.97);
    },
  );

  it('shares the guaranteed minimum among several extractor readers instead of giving each one the share', async () => {
    const { clock, reader, mbps } = rig(60);
    reader('encoder', () => encoder(HEALTHY_LEAD));
    reader('extractor-a', () => extractor);
    reader('extractor-b', () => extractor);
    await clock.advance(30_000);

    const total = mbps('extractor-a', 5000, 30_000) + mbps('extractor-b', 5000, 30_000);
    expect(total).toBeGreaterThanOrEqual(12 * 0.95);
    expect(total).toBeLessThanOrEqual(12 * 1.25);
  });

  it('is honoured next to several healthy encoders of different leads', async () => {
    const { clock, reader, mbps } = rig(60);
    reader('near', () => encoder(LOW_LEAD_SEC + 1));
    reader('far', () => encoder(120));
    reader('extractor', () => extractor);
    await clock.advance(30_000);
    expect(mbps('extractor', 5000, 30_000)).toBeGreaterThanOrEqual(12 * 0.95);
  });

  it('lets an encoder below the low lead take the whole cap, aging included', async () => {
    const { clock, reader, mbps, log } = rig(60);
    reader('encoder', () => encoder(LOW_LEAD_SEC - 5));
    reader('extractor', () => extractor);
    await clock.advance(30_000);

    // Only the very first chunks, served from the full bucket before the encoder ever waited, may go to the extractor.
    expect(mbps('extractor', 1000, 30_000)).toBe(0);
    expect(log.filter((grant) => grant.who === 'extractor' && grant.at >= 1000)).toHaveLength(0);
    expect(mbps('encoder', 1000, 30_000)).toBeGreaterThan(60 * 0.97);
  });

  it('follows the encoder lead: share while healthy, nothing while below the low lead, share again after', async () => {
    const { clock, reader, mbps } = rig(60);
    let lead = HEALTHY_LEAD;
    reader('encoder', () => encoder(lead));
    reader('extractor', () => extractor);

    await clock.advance(10_000);
    expect(mbps('extractor', 2000, 10_000)).toBeGreaterThanOrEqual(12 * 0.95);

    lead = LOW_LEAD_SEC - 1;
    await clock.advance(10_000);
    expect(mbps('extractor', 12_000, 20_000)).toBe(0);

    lead = HEALTHY_LEAD;
    await clock.advance(10_000);
    expect(mbps('extractor', 22_000, 30_000)).toBeGreaterThanOrEqual(12 * 0.95);
  });

  it('suspends the share when only one of two waiting encoders is below the low lead', async () => {
    const { clock, reader, mbps } = rig(60);
    reader('healthy', () => encoder(120));
    reader('risky', () => encoder(LOW_LEAD_SEC - 5));
    reader('extractor', () => extractor);
    await clock.advance(20_000);
    expect(mbps('extractor', 2000, 20_000)).toBe(0);
    expect(mbps('risky', 2000, 20_000)).toBeGreaterThan(60 * 0.9);
  });
});

describe('DownloadGate extractor share is a minimum, not a reservation', () => {
  it('gives the whole cap to the encoder when no extractor is reading', async () => {
    const { clock, reader, mbps } = rig(60);
    reader('encoder', () => encoder(HEALTHY_LEAD));
    await clock.advance(20_000);
    expect(mbps('encoder', 2000, 20_000)).toBeGreaterThan(60 * 0.97);
  });

  it('hands the unused part of the share to the encoder when the extractor wants less than its share', async () => {
    const { clock, reader, mbps, worstWindowBytes } = rig(60);
    reader('encoder', () => encoder(HEALTHY_LEAD));
    // 64 KiB every 175 ms is about 3 Mbps.
    reader('extractor', () => extractor, 175);
    await clock.advance(30_000);

    const wanted = mbps('extractor', 5000, 30_000);
    expect(wanted).toBeGreaterThan(2.5);
    expect(wanted).toBeLessThan(3.5);
    expect(mbps('encoder', 5000, 30_000)).toBeGreaterThan(60 - wanted - 3);
    expect(worstWindowBytes(0, 30_000)).toBeLessThanOrEqual(mbpsToBytesPerSec(60) * 5 * 1.05);
  });

  it('lets the extractor use the whole cap when no encoder is reading', async () => {
    const { clock, reader, mbps } = rig(60);
    reader('extractor', () => extractor);
    await clock.advance(20_000);
    expect(mbps('extractor', 2000, 20_000)).toBeGreaterThan(60 * 0.97);
  });

  it('does not store the share while the extractor is idle: a returning extractor gets no burst beyond the cap', async () => {
    const { clock, reader, mbps, worstWindowBytes } = rig(60);
    reader('encoder', () => encoder(HEALTHY_LEAD));
    await clock.advance(20_000);
    reader('extractor', () => extractor);
    await clock.advance(20_000);

    expect(mbps('extractor', 22_000, 40_000)).toBeLessThanOrEqual(12 * 1.25);
    expect(worstWindowBytes(0, 40_000)).toBeLessThanOrEqual(mbpsToBytesPerSec(60) * 5 * 1.05);
  });

  it('does not let an extractor that was served alone run up a debt that costs it the share later', async () => {
    const { clock, reader, mbps } = rig(60);
    reader('extractor', () => extractor);
    await clock.advance(20_000);
    reader('encoder', () => encoder(HEALTHY_LEAD));
    await clock.advance(20_000);
    expect(mbps('extractor', 22_000, 40_000)).toBeGreaterThanOrEqual(12 * 0.9);
  });
});
