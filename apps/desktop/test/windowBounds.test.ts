import { describe, expect, it } from 'vitest';
import type { Logger } from '../src/logger.js';
import { placeWindow, type BoundsWindow } from '../src/windowBounds.js';
import type { Rect } from '../src/windowState.js';

/** A window whose frame adds `grow` to every rectangle it is given, like a frame that is counted twice. */
class InflatingWindow implements BoundsWindow {
  private native: Rect;
  calls: Rect[] = [];

  constructor(
    start: Rect,
    private readonly grow: { x: number; y: number; width: number; height: number },
  ) {
    this.native = start;
  }

  getBounds(): Rect {
    return this.native;
  }

  setBounds(bounds: Rect): void {
    this.calls.push(bounds);
    this.native = {
      x: bounds.x + this.grow.x,
      y: bounds.y + this.grow.y,
      width: bounds.width + this.grow.width,
      height: bounds.height + this.grow.height,
    };
  }
}

function recordingLogger(): { logger: Logger; lines: Array<[string, Record<string, unknown> | undefined]> } {
  const lines: Array<[string, Record<string, unknown> | undefined]> = [];
  const record = (message: string, fields?: Record<string, unknown>): void => {
    lines.push([message, fields]);
  };
  return { logger: { debug: record, info: record, warn: record, error: record }, lines };
}

const WANTED: Rect = { x: 200, y: 120, width: 1300, height: 820 };

describe('placeWindow', () => {
  it('leaves a window alone that already has the wanted rectangle after one setBounds', () => {
    const window = new InflatingWindow(WANTED, { x: 0, y: 0, width: 0, height: 0 });
    const { logger, lines } = recordingLogger();
    placeWindow(window, WANTED, logger);
    expect(window.getBounds()).toEqual(WANTED);
    expect(window.calls).toEqual([WANTED]);
    expect(lines).toEqual([]);
  });

  it('removes the 4 x 3 px growth a constructor adds (1300x820 must not come back as 1304x823)', () => {
    const window = new InflatingWindow(
      { x: 200, y: 120, width: 1304, height: 823 },
      { x: 0, y: 0, width: 4, height: 3 },
    );
    const { logger, lines } = recordingLogger();
    placeWindow(window, WANTED, logger);
    expect(window.getBounds()).toEqual(WANTED);
    expect(window.calls).toHaveLength(2);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.[0]).toBe('window rectangle corrected');
    expect(lines[0]?.[1]).toEqual({ dx: 0, dy: 0, dw: -4, dh: -3 });
  });

  it('also corrects a shifted position', () => {
    const window = new InflatingWindow(WANTED, { x: 7, y: 0, width: 14, height: 6 });
    placeWindow(window, WANTED, recordingLogger().logger);
    expect(window.getBounds()).toEqual(WANTED);
  });

  it('stops after one correction when the window cannot be placed exactly', () => {
    const stubborn: BoundsWindow & { calls: number } = {
      calls: 0,
      getBounds: () => ({ x: 0, y: 0, width: 1500, height: 900 }),
      setBounds() {
        this.calls += 1;
      },
    };
    placeWindow(stubborn, WANTED, recordingLogger().logger);
    expect(stubborn.calls).toBe(2);
  });
});
