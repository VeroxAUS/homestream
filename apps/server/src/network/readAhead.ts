export type ReadAheadState = 'filling' | 'waiting';

/**
 * Hysteresis for the read-ahead window: reading stops once the lead reaches `holdAtSec` and resumes only when it is back
 * below `resumeSec`, so a player advancing second by second does not start and stop the download on every segment.
 */
export class ReadAheadWindow {
  private current: ReadAheadState = 'filling';

  constructor(
    readonly holdAtSec: number,
    readonly resumeSec: number,
  ) {}

  get state(): ReadAheadState {
    return this.current;
  }

  get waiting(): boolean {
    return this.current === 'waiting';
  }

  /** Feeds the current lead (seconds ahead of the player); returns true when the state changed. */
  update(leadSec: number): boolean {
    const before = this.current;
    if (this.current === 'filling' && leadSec >= this.holdAtSec) this.current = 'waiting';
    else if (this.current === 'waiting' && leadSec < this.resumeSec) this.current = 'filling';
    return this.current !== before;
  }

  /** A start, seek or encoder restart opens a fresh window. Returns true when it was waiting. */
  reset(): boolean {
    const was = this.waiting;
    this.current = 'filling';
    return was;
  }
}

/** End of the last finished segment minus the player's position. */
export function leadSeconds(headSegment: number, segmentSec: number, playheadSec: number): number {
  return (headSegment + 1) * segmentSec - playheadSec;
}
