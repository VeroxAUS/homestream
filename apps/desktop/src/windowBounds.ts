import type { Logger } from './logger.js';
import type { Rect } from './windowState.js';

export interface BoundsWindow {
  getBounds(): Rect;
  setBounds(bounds: Rect): void;
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Puts the window on `wanted`, as `getBounds()` reports it. The BrowserWindow constructor adds the invisible resize
 * border of a frameless Windows window to the rectangle it is given, so a saved 1300x820 came back as 1304x823 and
 * grew on every launch. `setBounds` is measured against `getBounds()`, which is also what the saved state is read
 * from, so one correction by the observed difference makes saving and restoring agree.
 */
export function placeWindow(window: BoundsWindow, wanted: Rect, logger: Logger): void {
  window.setBounds(wanted);
  const actual = window.getBounds();
  if (sameRect(actual, wanted)) return;
  const delta = {
    dx: wanted.x - actual.x,
    dy: wanted.y - actual.y,
    dw: wanted.width - actual.width,
    dh: wanted.height - actual.height,
  };
  logger.info('window rectangle corrected', delta);
  window.setBounds({
    x: wanted.x + delta.dx,
    y: wanted.y + delta.dy,
    width: wanted.width + delta.dw,
    height: wanted.height + delta.dh,
  });
}
