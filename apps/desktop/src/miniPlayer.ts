import type { Handover } from '@homestream/shared';
import type { Rect } from './windowState.js';

export const MINI_WIDTH = 480;
export const MINI_HEIGHT = 270;
export const MINI_MIN_WIDTH = 320;
export const MINI_MIN_HEIGHT = 180;
const MINI_MARGIN = 16;

/** Bottom-right of the work area with a 16 px margin. */
export function miniBounds(workArea: Rect): Rect {
  return {
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
    x: workArea.x + workArea.width - MINI_WIDTH - MINI_MARGIN,
    y: workArea.y + workArea.height - MINI_HEIGHT - MINI_MARGIN,
  };
}

/** The player route of a title in attach mode: the page waits for the hand-over instead of starting a session. */
export function attachRoute(mediaKey: string, mini: boolean): string | null {
  const movie = /^movie:(\d{1,9})$/.exec(mediaKey);
  const tv = /^tv:(\d{1,9}):(\d{1,4}):(\d{1,4})$/.exec(mediaKey);
  let base: string;
  if (movie) base = `/play/movie/${movie[1]}`;
  else if (tv) base = `/play/tv/${tv[1]}/${tv[2]}/${tv[3]}`;
  else return null;
  return `${base}?attach=1${mini ? '&mini=1' : ''}`;
}

export type MiniPhase = 'closed' | 'open';

/**
 * Which window holds the playing session. The hand-over only moves the page that plays it: it never starts or ends the
 * session, so the main player and the mini player share one session id for as long as they trade it.
 */
export class MiniPlayerState {
  private current: Handover | null = null;
  private mainRoute = '';
  private pending: Handover | null = null;
  private onTop = true;

  get phase(): MiniPhase {
    return this.current ? 'open' : 'closed';
  }

  get alwaysOnTop(): boolean {
    return this.onTop;
  }

  get sessionId(): string | null {
    return this.current?.sessionId ?? null;
  }

  /** Main -> mini. Fails when a mini player is already open (one session at a time) or the title is unknown. */
  open(handover: Handover): { route: string } | null {
    if (this.current) return null;
    const route = attachRoute(handover.mediaKey, true);
    const back = attachRoute(handover.mediaKey, false);
    if (!route || !back) return null;
    this.current = handover;
    this.mainRoute = back;
    this.pending = handover;
    this.onTop = true;
    return { route };
  }

  /** The mini page asks for the hand-over once; later asks get nothing. */
  claim(): Handover | null {
    const handover = this.pending;
    this.pending = null;
    return handover;
  }

  /** Mini -> main: only the session the mini player holds can be handed back. */
  giveBack(handover: Handover): { route: string } | null {
    if (!this.current || this.current.sessionId !== handover.sessionId) return null;
    this.current = null;
    this.pending = handover;
    return { route: this.mainRoute };
  }

  /** Mini Close: playback ended in the mini page; the main window goes to the title's details page. */
  close(): string | null {
    const mediaKey = this.current?.mediaKey ?? null;
    this.current = null;
    this.pending = null;
    return mediaKey;
  }

  setAlwaysOnTop(value: boolean): boolean {
    this.onTop = value;
    return this.onTop;
  }
}
