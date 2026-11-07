import { describe, expect, it, vi } from 'vitest';
import type { FileIo } from '../src/jsonFile.js';
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  debounce,
  loadWindowState,
  parseWindowState,
  resolveWindowState,
  saveWindowState,
  type DisplayInfo,
} from '../src/windowState.js';

const primary: DisplayInfo = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const second: DisplayInfo = { id: 2, workArea: { x: -1920, y: 0, width: 1920, height: 1040 } };
const saved = { x: 100, y: 80, width: 1200, height: 700, maximized: false, displayId: 1 };

describe('parseWindowState', () => {
  it('accepts numbers and rounds them', () => {
    expect(parseWindowState({ ...saved, x: 100.4, maximized: true })).toMatchObject({ x: 100, maximized: true });
  });

  it.each([
    null,
    'x',
    {},
    { ...saved, width: 0 },
    { ...saved, x: Number.NaN },
    { ...saved, y: 9e9 },
    { ...saved, height: '5' },
  ])('rejects nonsense %#', (value) => {
    expect(parseWindowState(value)).toBeNull();
  });

  it('falls back to display -1 when the id is missing', () => {
    expect(parseWindowState({ x: 0, y: 0, width: 10, height: 10 })?.displayId).toBe(-1);
  });
});

describe('resolveWindowState', () => {
  it('centres the default size on the primary display without a saved state', () => {
    const { bounds, maximized } = resolveWindowState(null, [primary], primary);
    expect(bounds).toEqual({
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      x: Math.round((1920 - DEFAULT_WINDOW_WIDTH) / 2),
      y: Math.round((1040 - DEFAULT_WINDOW_HEIGHT) / 2),
    });
    expect(maximized).toBe(false);
  });

  it('keeps a rectangle that lies inside a display, also on a second display', () => {
    expect(resolveWindowState(saved, [primary, second], primary).bounds).toEqual({
      x: 100,
      y: 80,
      width: 1200,
      height: 700,
    });
    const left = { ...saved, x: -1800, displayId: 2 };
    expect(resolveWindowState(left, [primary, second], primary).bounds.x).toBe(-1800);
  });

  it('centres on the primary display when the saved display is gone', () => {
    const left = { ...saved, x: -1800, displayId: 2 };
    const { bounds } = resolveWindowState(left, [primary], primary);
    expect(bounds).toEqual({ width: 1200, height: 700, x: 360, y: 170 });
  });

  it('centres a rectangle that sticks out of the work area', () => {
    const { bounds } = resolveWindowState({ ...saved, x: 1500 }, [primary], primary);
    expect(bounds.x).toBe(360);
  });

  it('never goes below the minimum and never above the work area', () => {
    expect(resolveWindowState({ ...saved, width: 300, height: 200 }, [primary], primary).bounds).toMatchObject({
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT,
    });
    const huge = resolveWindowState({ ...saved, x: 5000, width: 5000, height: 3000 }, [primary], primary).bounds;
    expect(huge.width).toBe(1920);
    expect(huge.height).toBe(1040);
  });

  it('remembers maximised', () => {
    expect(resolveWindowState({ ...saved, maximized: true }, [primary], primary).maximized).toBe(true);
    expect(resolveWindowState({ ...saved, x: 9999, maximized: true }, [primary], primary).maximized).toBe(true);
  });
});

describe('window state file and debounce', () => {
  it('round-trips through the file io', () => {
    const files: Record<string, string> = {};
    const io: FileIo = { read: (f) => files[f] ?? null, writeAtomic: (f, t) => void (files[f] = t) };
    expect(loadWindowState('w.json', io)).toBeNull();
    saveWindowState('w.json', saved, io);
    expect(loadWindowState('w.json', io)).toEqual(saved);
  });

  it('saves once after a quiet period and flushes on demand', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const saver = debounce(save, 500);
    saver.trigger();
    saver.trigger();
    vi.advanceTimersByTime(499);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    saver.trigger();
    saver.flush();
    saver.flush();
    expect(save).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
