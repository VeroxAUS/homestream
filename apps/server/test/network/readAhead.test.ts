import { describe, expect, it } from 'vitest';
import {
  ENCODER_INFLIGHT_BYTES,
  ENCODER_PIPELINE_SEC,
  PROGRESS_LATENCY_SEC,
  ReadAheadWindow,
  encoderWindowSec,
  holdLeadSec,
  leadSeconds,
  pipelineAllowanceSec,
} from '../../src/network/readAhead.js';

const MBPS = 1_000_000 / 8;
const LOW_BITRATE = 7.15 * MBPS;
const HIGH_BITRATE = 25 * MBPS;

describe('pipelineAllowanceSec', () => {
  it('is the fixed allowance when the bytes in flight are only a few seconds of the source', () => {
    expect(pipelineAllowanceSec(HIGH_BITRATE)).toBe(ENCODER_PIPELINE_SEC);
    expect(pipelineAllowanceSec(35 * MBPS)).toBe(ENCODER_PIPELINE_SEC);
  });

  it('grows at a low bitrate, where the same bytes are more seconds of video', () => {
    expect(pipelineAllowanceSec(LOW_BITRATE)).toBeCloseTo(ENCODER_INFLIGHT_BYTES / LOW_BITRATE, 6);
    expect(pipelineAllowanceSec(LOW_BITRATE)).toBeGreaterThan(9);
    expect(pipelineAllowanceSec(2 * MBPS)).toBeGreaterThan(pipelineAllowanceSec(LOW_BITRATE));
  });

  it('falls back to the fixed allowance when the bitrate is unknown', () => {
    expect(pipelineAllowanceSec(0)).toBe(ENCODER_PIPELINE_SEC);
    expect(pipelineAllowanceSec(Number.NaN)).toBe(ENCODER_PIPELINE_SEC);
  });
});

describe('holdLeadSec', () => {
  it('is the measured lead while the encoder is idle and the bitrate is high', () => {
    expect(holdLeadSec(150, 0, HIGH_BITRATE)).toBe(150);
    expect(holdLeadSec(150, -1, HIGH_BITRATE)).toBe(150);
  });

  it('adds what the encoder finishes before the next progress report', () => {
    expect(holdLeadSec(150, 8, HIGH_BITRATE)).toBeCloseTo(150 + 8 * PROGRESS_LATENCY_SEC, 6);
  });

  it('adds the extra seconds of in-flight bytes at a low bitrate', () => {
    const extra = pipelineAllowanceSec(LOW_BITRATE) - ENCODER_PIPELINE_SEC;
    expect(holdLeadSec(150, 0, LOW_BITRATE)).toBeCloseTo(150 + extra, 6);
  });
});

/**
 * The encoder finishes `speed` seconds of video per second while the download is open and reports its progress once per
 * second. The bytes already past the proxy when the reads stop (`inFlightBytes`) are still encoded afterwards.
 */
function finalLead(options: {
  bytesPerSec: number;
  speed: number;
  inFlightBytes: number;
  anticipate: boolean;
  progressOffsetSec: number;
}): number {
  const { bytesPerSec, speed, inFlightBytes, anticipate, progressOffsetSec } = options;
  const window = new ReadAheadWindow(encoderWindowSec(180), 120);
  let finished = 0;
  let wallSec = 0;
  let nextReport = progressOffsetSec;
  const STEP = 0.05;
  for (; wallSec < 400; wallSec += STEP) {
    if (wallSec >= nextReport) {
      nextReport += 1;
      const lead = leadSeconds(Math.floor(finished / 4), 4, 0);
      window.update(lead, anticipate ? holdLeadSec(lead, speed, bytesPerSec) : lead);
      if (window.waiting) return leadSeconds(Math.floor((finished + inFlightBytes / bytesPerSec) / 4), 4, 0);
    }
    finished += speed * STEP;
  }
  throw new Error('window never closed');
}

describe('lead after the window closes', () => {
  const cases = [
    { name: '7 Mbps source at the 60 Mbps cap (about 8x)', bytesPerSec: LOW_BITRATE, speed: 8.4 },
    { name: '25 Mbps source at the 60 Mbps cap (about 2.4x)', bytesPerSec: HIGH_BITRATE, speed: 2.4 },
    { name: '35 Mbps source at the 60 Mbps cap (about 1.7x)', bytesPerSec: 35 * MBPS, speed: 1.7 },
  ];

  for (const { name, bytesPerSec, speed } of cases) {
    it(`stays within 184 s for a ${name}, wherever the progress reports fall`, () => {
      for (let offset = 0; offset < 1; offset += 0.1) {
        const lead = finalLead({
          bytesPerSec,
          speed,
          inFlightBytes: ENCODER_INFLIGHT_BYTES,
          anticipate: true,
          progressOffsetSec: offset,
        });
        expect(lead).toBeLessThanOrEqual(184);
      }
    });
  }

  it('overshoots 184 s at 7 Mbps when the hold ignores the speed and the bytes in flight', () => {
    const lead = finalLead({
      bytesPerSec: LOW_BITRATE,
      speed: 8.4,
      inFlightBytes: ENCODER_INFLIGHT_BYTES,
      anticipate: false,
      progressOffsetSec: 0.9,
    });
    expect(lead).toBeGreaterThan(184);
  });
});

describe('ReadAheadWindow', () => {
  it('starts filling, waits at the limit and resumes only below the resume lead', () => {
    const window = new ReadAheadWindow(180, 120);
    expect(window.state).toBe('filling');
    expect(window.update(179.9)).toBe(false);
    expect(window.update(180)).toBe(true);
    expect(window.state).toBe('waiting');
    expect(window.update(200)).toBe(false);
    // Between the two points the state does not change either way.
    expect(window.update(150)).toBe(false);
    expect(window.waiting).toBe(true);
    expect(window.update(120)).toBe(false);
    expect(window.update(119.9)).toBe(true);
    expect(window.state).toBe('filling');
    expect(window.update(150)).toBe(false);
    expect(window.state).toBe('filling');
  });

  it('closes on the anticipated lead but resumes on the real one', () => {
    const window = new ReadAheadWindow(176, 120);
    expect(window.update(160, 175.9)).toBe(false);
    expect(window.update(160, 176)).toBe(true);
    // The anticipation is for closing only: a waiting window still resumes at the real lead.
    expect(window.update(125, 140)).toBe(false);
    expect(window.update(119.9, 180)).toBe(true);
    expect(window.state).toBe('filling');
  });

  it('opens a fresh window on reset and says whether it was waiting', () => {
    const window = new ReadAheadWindow(180, 120);
    expect(window.reset()).toBe(false);
    window.update(181);
    expect(window.reset()).toBe(true);
    expect(window.state).toBe('filling');
  });
});

describe('leadSeconds', () => {
  it('counts the end of the last finished segment minus the player position', () => {
    expect(leadSeconds(44, 4, 0)).toBe(180);
    expect(leadSeconds(0, 4, 0)).toBe(4);
    expect(leadSeconds(100, 4, 250)).toBe(154);
  });
});
