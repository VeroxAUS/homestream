import { describe, expect, it } from 'vitest';
import { ENCODER_PIPELINE_SEC, ReadAheadWindow, encoderWindowSec } from '../../src/network/readAhead.js';
import { ExtractorWindows } from '../../src/playback/extractorWindow.js';

const HOLD = 176;
const RESUME = 120;
const BEHIND = 120;

function rig() {
  const holds = new Map<number, boolean>();
  const windows = new ExtractorWindows({
    holdSec: HOLD,
    resumeSec: RESUME,
    behindSec: BEHIND,
    setHold: (runId, held) => holds.set(runId, held),
  });
  return { windows, holds };
}

describe('encoderWindowSec', () => {
  it('closes the extractor window where the encoder window closes: the configured window minus the encoder pipeline', () => {
    expect(ENCODER_PIPELINE_SEC).toBe(4);
    expect(encoderWindowSec(180)).toBe(176);
    expect(encoderWindowSec(240)).toBe(236);
    expect(encoderWindowSec(2)).toBe(1);
  });
});

describe('ExtractorWindows', () => {
  it('holds a run by its read position past the player, whatever offset it started from', () => {
    const { windows, holds } = rig();
    // A run started at 588 while the player is at 0 (a seek back): its start is far ahead of the player, so it is held at once.
    expect(windows.sync([{ id: 1, headSec: 600 }], 0)).toEqual([]);
    expect(holds.get(1)).toBe(true);
    expect(windows.isHeld(1)).toBe(true);
  });

  it('does not hold a run that has not yet read a window past the player', () => {
    const { windows, holds } = rig();
    expect(windows.sync([{ id: 1, headSec: 100 + HOLD - 1 }], 100)).toEqual([]);
    expect(holds.has(1)).toBe(false);
    expect(windows.isHeld(1)).toBe(false);
  });

  it('holds at the hold distance and releases only below the resume distance', () => {
    const { windows, holds } = rig();
    windows.sync([{ id: 1, headSec: 100 + HOLD }], 100);
    expect(holds.get(1)).toBe(true);
    windows.sync([{ id: 1, headSec: 100 + HOLD }], 100 + HOLD - RESUME - 1);
    expect(holds.get(1)).toBe(true);
    windows.sync([{ id: 1, headSec: 100 + HOLD }], 100 + HOLD - RESUME + 1);
    expect(holds.get(1)).toBe(false);
    expect(windows.isHeld(1)).toBe(false);
  });

  it('reports a run whose read position is too far behind the player so its owner can stop it', () => {
    const { windows, holds } = rig();
    expect(windows.sync([{ id: 1, headSec: 400 }], 3600)).toEqual([1]);
    expect(windows.sync([{ id: 1, headSec: 3600 - BEHIND }], 3600)).toEqual([]);
    expect(windows.sync([{ id: 1, headSec: 3600 - BEHIND - 1 }], 3600)).toEqual([1]);
    expect(holds.size).toBe(0);
  });

  it('keeps a run just behind the player: it still delivers the cues the player needs next', () => {
    const { windows } = rig();
    expect(windows.sync([{ id: 1, headSec: 90 }], 100)).toEqual([]);
  });

  it('releases the hold of a run that is gone', () => {
    const { windows, holds } = rig();
    windows.sync([{ id: 1, headSec: 400 }], 0);
    windows.release(1);
    expect(holds.get(1)).toBe(false);
    windows.release(1);
    expect(windows.isHeld(1)).toBe(false);
  });
});

describe('session demand after the window fills (virtual clock)', () => {
  interface Demand {
    encoder: number;
    extractor: number;
  }

  /**
   * Plays a session on a virtual clock: the player advances 1 s per second, the encoder reads `encoderSpeed` s of media per
   * second until its window waits, and the extractor run reads `extractorSpeed` s per second until its own window holds it.
   */
  function simulate(options: {
    encoderSpeed: number;
    extractorSpeed: number;
    extractorStart: number;
    seconds: number;
  }) {
    const { windows } = rig();
    const encoderWindow = new ReadAheadWindow(HOLD, RESUME);
    let encoderHead = 0;
    let extractorHead = options.extractorStart;
    let waitingSince: number | null = null;
    const timeline: Demand[] = [];
    for (let t = 0; t < options.seconds; t += 1) {
      const playhead = t;
      if (!encoderWindow.waiting) encoderHead += options.encoderSpeed;
      encoderWindow.update(encoderHead - playhead);
      if (encoderWindow.waiting) waitingSince ??= t;
      windows.sync([{ id: 1, headSec: extractorHead }], playhead);
      if (!windows.isHeld(1)) extractorHead += options.extractorSpeed;
      windows.sync([{ id: 1, headSec: extractorHead }], playhead);
      timeline.push({ encoder: encoderWindow.waiting ? 0 : 1, extractor: windows.isHeld(1) ? 0 : 1 });
    }
    return { timeline, waitingSince };
  }

  it('falls to zero within 10 s of the encoder window waiting when the extractor reads faster than the encoder', () => {
    const { timeline, waitingSince } = simulate({
      encoderSpeed: 3,
      extractorSpeed: 25,
      extractorStart: 0,
      seconds: 200,
    });
    expect(waitingSince).not.toBeNull();
    const start = waitingSince as number;
    for (let t = start + 10; t < start + 40; t += 1) {
      const demand = timeline[t] as Demand;
      expect(demand.encoder + demand.extractor, `second ${t}`).toBe(0);
    }
  });

  it('falls to zero within 10 s when the extractor was started far ahead of the player (after a seek back)', () => {
    const { timeline, waitingSince } = simulate({
      encoderSpeed: 3,
      extractorSpeed: 25,
      extractorStart: 600,
      seconds: 200,
    });
    const start = waitingSince as number;
    expect((timeline[0] as Demand).extractor).toBe(0);
    for (let t = start + 10; t < start + 40; t += 1) {
      const demand = timeline[t] as Demand;
      expect(demand.encoder + demand.extractor, `second ${t}`).toBe(0);
    }
  });

  it('keeps a trailing run reading below the window, so its guaranteed share still applies', () => {
    const { timeline, waitingSince } = simulate({
      encoderSpeed: 3,
      extractorSpeed: 0.5,
      extractorStart: 0,
      seconds: 200,
    });
    const start = waitingSince as number;
    expect((timeline[start + 10] as Demand).extractor).toBe(1);
    expect((timeline[start + 10] as Demand).encoder).toBe(0);
  });
});
