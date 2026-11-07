import { nodeFileIo, readJson, writeJson, type FileIo } from './jsonFile.js';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: number;
  workArea: Rect;
}

export interface WindowState extends Rect {
  maximized: boolean;
  displayId: number;
}

export const MIN_WINDOW_WIDTH = 1024;
export const MIN_WINDOW_HEIGHT = 640;
export const DEFAULT_WINDOW_WIDTH = 1360;
export const DEFAULT_WINDOW_HEIGHT = 840;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The saved window, or `null` when the file is missing, damaged or holds nonsense numbers. */
export function parseWindowState(raw: unknown): WindowState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y, width, height, maximized, displayId } = raw as Record<string, unknown>;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return null;
  if (width <= 0 || height <= 0 || Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    maximized: maximized === true,
    displayId: finite(displayId) ? displayId : -1,
  };
}

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Size never below the minimum, never above the work area (unless the work area itself is below the minimum). */
function fitSize(size: Pick<Rect, 'width' | 'height'>, workArea: Rect): Pick<Rect, 'width' | 'height'> {
  return {
    width: Math.max(MIN_WINDOW_WIDTH, Math.min(size.width, workArea.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.min(size.height, workArea.height)),
  };
}

function centred(size: Pick<Rect, 'width' | 'height'>, workArea: Rect): Rect {
  return {
    ...size,
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + (workArea.height - size.height) / 2),
  };
}

export interface ResolvedWindow {
  bounds: Rect;
  maximized: boolean;
}

/**
 * Where the window opens. A saved rectangle that lies fully inside a connected display's work area is kept (never below
 * the minimum size); anything else, including a display that is gone, is centred on the primary display. Fullscreen is
 * not part of the state, so it is never restored.
 */
export function resolveWindowState(
  saved: WindowState | null,
  displays: readonly DisplayInfo[],
  primary: DisplayInfo,
): ResolvedWindow {
  if (!saved)
    return {
      bounds: centred(
        fitSize({ width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT }, primary.workArea),
        primary.workArea,
      ),
      maximized: false,
    };

  const size = {
    width: Math.max(MIN_WINDOW_WIDTH, saved.width),
    height: Math.max(MIN_WINDOW_HEIGHT, saved.height),
  };
  const candidate: Rect = { x: saved.x, y: saved.y, ...size };
  const host = displays.find((display) => inside(candidate, display.workArea));
  if (host) return { bounds: candidate, maximized: saved.maximized };
  return { bounds: centred(fitSize(size, primary.workArea), primary.workArea), maximized: saved.maximized };
}

export function loadWindowState(file: string, io: FileIo = nodeFileIo): WindowState | null {
  return parseWindowState(readJson(file, io));
}

export function saveWindowState(file: string, state: WindowState, io: FileIo = nodeFileIo): void {
  writeJson(file, state, io);
}

/** Runs `save` once after `delayMs` of quiet; `flush` runs a pending save now (on quit). */
export function debounce(save: () => void, delayMs: number): { trigger(): void; flush(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    trigger() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        save();
      }, delayMs);
    },
    flush() {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      save();
    },
  };
}
