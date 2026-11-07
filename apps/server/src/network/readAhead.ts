export type ReadAheadState = 'filling' | 'waiting';

/**
 * ffmpeg keeps a few seconds of input in its demuxer and encoder after its last finished segment, so the window is closed
 * this much early: the finished-segment lead then stays within the configured window.
 */
export const ENCODER_PIPELINE_SEC = 4;

/** Lead at which the encoder's reads wait; subtitle extractors hold at the same distance so a full window stops all reads. */
export function encoderWindowSec(readAheadSec: number): number {
  return Math.max(1, readAheadSec - ENCODER_PIPELINE_SEC);
}

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
