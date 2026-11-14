import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadAheadPacing } from '../../src/playback/readAheadPacing.js';
import type { PlaybackContext } from '../../src/playback/context.js';
import type { SessionRecord } from '../../src/playback/session.js';

const DURATION_SEC = 7200;

interface Call {
  lead: number;
  close: number | undefined;
}

function rig(sourceMbps: number) {
  const calls: Call[] = [];
  const rec = {
    positionSec: 0,
    startSegment: 0,
    stats: { outTimeSec: 0, headSegment: 0, speed: 0 },
    probe: { durationSec: DURATION_SEC },
    source: {
      sizeBytes: (sourceMbps * 1_000_000 * DURATION_SEC) / 8,
      setLead: (lead: number, close?: number) => calls.push({ lead, close }),
    },
  } as unknown as SessionRecord;
  const pacing = new ReadAheadPacing({} as PlaybackContext);
  /** The encoder finishes `speed` seconds per second; ffmpeg reports once per second. */
  const report = (outTimeSec: number) => {
    rec.stats = { ...rec.stats, outTimeSec, headSegment: Math.floor(outTimeSec / 4) };
    pacing.trackSpeed(rec);
    pacing.syncReadAhead(rec);
    return calls.at(-1) as Call;
  };
  return { report };
}

describe('ReadAheadPacing anticipates the lead the window closes on', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function run(sourceMbps: number, speed: number) {
    const { report } = rig(sourceMbps);
    let last = report(0);
    for (let second = 1; second <= 20; second += 1) {
      vi.setSystemTime(second * 1000);
      last = report(second * speed);
    }
    return last;
  }

  it('adds the seconds finished before the next report and the in-flight bytes at a 7 Mbps source (8x)', () => {
    const { lead, close } = run(7.15, 8);
    expect(close).toBeDefined();
    // 8 s per second for the 1.5 s between reports, and the extra seconds the 8 MiB in flight are at 7.15 Mbps.
    expect((close as number) - lead).toBeGreaterThan(17);
    expect((close as number) - lead).toBeLessThan(19);
  });

  it('adds only the seconds finished before the next report at a 25 Mbps source (2.4x)', () => {
    const { lead, close } = run(25, 2.4);
    expect((close as number) - lead).toBeCloseTo(2.4 * 1.5, 1);
  });

  it('adds only the in-flight seconds before the encoder speed is known', () => {
    const { report } = rig(7.15);
    const first = report(0);
    expect((first.close as number) - first.lead).toBeCloseTo(5.4, 1);
  });
});
