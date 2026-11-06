import { COMPLETION_RATIO, RESUME_MIN_SEC, type PingState } from '@homestream/shared';

export { RESUME_MIN_SEC };

/** Playing time credited to one gap between pings is capped, so a client that went silent cannot add minutes. */
export const MAX_PING_GAP_SEC = 30;

const EPSILON = 1e-6;

/** The only completion rule: 92 % of the duration. */
export function isCompleted(positionSec: number, durationSec: number): boolean {
  return durationSec > 0 && positionSec + EPSILON >= durationSec * COMPLETION_RATIO;
}

export function isResumable(positionSec: number, completed: boolean): boolean {
  return !completed && positionSec >= RESUME_MIN_SEC;
}

export function clampPosition(positionSec: number, durationSec: number): number {
  const position = Math.max(0, Number.isFinite(positionSec) ? positionSec : 0);
  return durationSec > 0 ? Math.min(position, durationSec) : position;
}

/**
 * Seconds of playing time in the gap since the previous ping. The state the previous ping reported is the state the player was in
 * during the gap, so pausing credits the time up to the pause and a resume credits nothing for the paused time.
 */
export function playingSecondsSince(previous: PingState | null, gapMs: number): number {
  if (previous !== 'playing' || !(gapMs > 0)) return 0;
  return Math.min(gapMs / 1000, MAX_PING_GAP_SEC);
}
