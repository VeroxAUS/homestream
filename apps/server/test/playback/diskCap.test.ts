import { describe, expect, it } from 'vitest';
import { IDLE_EVICT_MS, KEEP_BEHIND, planDiskCap, type DiskSession } from '../../src/playback/diskCap.js';

const MB = 1_000_000;

function session(
  id: string,
  overrides: Partial<DiskSession> & { segments?: number[]; segmentBytes?: number } = {},
): DiskSession {
  const { segments = [], segmentBytes = MB, ...rest } = overrides;
  return {
    id,
    sizes: new Map(segments.map((index) => [index, segmentBytes])),
    playerSegment: 0,
    headSegment: segments.length ? Math.max(...segments) + 1 : 0,
    encoderRunning: true,
    lastActivity: 1_000_000,
    ...rest,
  };
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const NOW = 1_000_000;

describe('planDiskCap', () => {
  it('does nothing while usage is well below the cap', () => {
    const plan = planDiskCap({ capBytes: 100 * MB, sessions: [session('a', { segments: range(0, 20) })], now: NOW });
    expect(plan).toEqual({ evict: new Map(), park: [], resume: [], stopIdle: [] });
  });

  it('evicts watched segments, oldest first, keeping a few behind the player', () => {
    const a = session('a', { segments: range(0, 59), playerSegment: 50 });
    const plan = planDiskCap({ capBytes: 70 * MB, sessions: [a], now: NOW });
    const evicted = plan.evict.get('a') ?? [];
    expect(evicted.length).toBeGreaterThan(0);
    expect(evicted[0]).toBe(0);
    expect(Math.max(...evicted)).toBeLessThan(50 - KEEP_BEHIND);
    expect(evicted).toEqual([...evicted].sort((x, y) => x - y));
    expect(plan.park).toEqual([]);
  });

  it('parks an encoder that runs far ahead of the player once nothing is left to evict', () => {
    const a = session('a', { segments: range(0, 89), playerSegment: 0 });
    const plan = planDiskCap({ capBytes: 100 * MB, sessions: [a], now: NOW });
    expect(plan.evict.size).toBe(0);
    expect(plan.park).toEqual(['a']);
  });

  it('does not park an encoder that is barely ahead of the player', () => {
    const a = session('a', { segments: range(0, 89), playerSegment: 85, headSegment: 90 });
    const plan = planDiskCap({ capBytes: 100 * MB, sessions: [a], now: NOW });
    expect(plan.park).toEqual([]);
  });

  it('resumes a parked encoder when space is free and the player caught up', () => {
    const a = session('a', { segments: range(0, 9), playerSegment: 8, encoderRunning: false });
    const plan = planDiskCap({ capBytes: 100 * MB, sessions: [a], now: NOW });
    expect(plan.resume).toEqual(['a']);
  });

  it('keeps a parked encoder parked while the player is far behind', () => {
    const a = session('a', { segments: range(0, 59), playerSegment: 0, encoderRunning: false, headSegment: 60 });
    const plan = planDiskCap({ capBytes: 1000 * MB, sessions: [a], now: NOW });
    expect(plan.resume).toEqual([]);
  });

  it('stops the oldest idle session when the cap is still exceeded, but never the last one', () => {
    const busy = session('busy', {
      segments: range(50, 59),
      segmentBytes: 10 * MB,
      playerSegment: 59,
      lastActivity: NOW,
    });
    const idle = session('idle', {
      segments: range(50, 59),
      segmentBytes: 10 * MB,
      playerSegment: 59,
      lastActivity: NOW - IDLE_EVICT_MS - 1,
      encoderRunning: false,
    });
    const two = planDiskCap({ capBytes: 70 * MB, sessions: [busy, idle], now: NOW });
    expect(two.stopIdle).toEqual(['idle']);
    const alone = planDiskCap({ capBytes: 30 * MB, sessions: [idle], now: NOW });
    expect(alone.stopIdle).toEqual([]);
    expect([...(alone.evict.get('idle') ?? [])].length).toBeGreaterThan(0);
  });

  it('as a last resort evicts from a lone session but protects segments around the player and the head', () => {
    const a = session('a', { segments: range(0, 59), playerSegment: 20, headSegment: 60 });
    const plan = planDiskCap({ capBytes: 20 * MB, sessions: [a], now: NOW });
    const evicted = new Set(plan.evict.get('a') ?? []);
    for (const keep of [20, 21, 22, 23, 24, 25, 58, 59]) expect(evicted.has(keep)).toBe(false);
    expect(evicted.size).toBeGreaterThan(0);
  });
});
