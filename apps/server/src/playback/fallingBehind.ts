import type { ReadAheadState } from '../network/readAhead.js';

/** An encoder below real time for longer than this while it is catching up counts as falling behind. */
export const FALLING_BEHIND_AFTER_MS = 30_000;
export const FALLING_BEHIND_SPEED = 1.0;

export interface SpeedObservation {
  speed: number;
  readAhead: ReadAheadState;
  /** The encoder has finished the file or is stopped; nothing to fall behind. */
  idle: boolean;
}

/**
 * Tracks how long each session's encoder has been slower than real time while it is filling its read-ahead window. A session
 * that is `waiting` at the window is idle by design and never counts, and a reading of 0 (no data yet) breaks the streak.
 */
export class FallingBehindWatch {
  private readonly since = new Map<string, number>();

  observe(sessionId: string, observation: SpeedObservation, nowMs: number): void {
    const slow = !observation.idle && observation.readAhead === 'filling' && observation.speed > 0 && observation.speed < FALLING_BEHIND_SPEED;
    if (!slow) this.since.delete(sessionId);
    else if (!this.since.has(sessionId)) this.since.set(sessionId, nowMs);
  }

  forget(sessionId: string): void {
    this.since.delete(sessionId);
  }

  /** Ids of the sessions that have been slow for more than the threshold. */
  fallingBehind(nowMs: number): string[] {
    return [...this.since].filter(([, start]) => nowMs - start > FALLING_BEHIND_AFTER_MS).map(([id]) => id);
  }
}
