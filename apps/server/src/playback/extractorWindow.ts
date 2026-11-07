import { ReadAheadWindow } from '../network/readAhead.js';

export interface WindowedRun {
  id: number;
  /** Newest source second the run has read. */
  headSec: number;
}

export interface ExtractorWindowOptions {
  /** Read position this far past the player holds a run; the encoder window closes at the same distance. */
  holdSec: number;
  /** A held run reads again once its position is back below this distance. */
  resumeSec: number;
  /** A run whose read position is this far behind the player cannot serve it any more. */
  behindSec: number;
  /** Holds (true) or releases the source reads of a run. */
  setHold: (runId: number, held: boolean) => void;
}

/**
 * The read-ahead window of every subtitle extractor run of a session. A run is measured by where it reads, not by where
 * it started: one that reads a full window past the player waits, wherever it began, and one left far behind the player
 * (a seek moved the player away) is reported so its owner can stop it.
 */
export class ExtractorWindows {
  private readonly windows = new Map<number, ReadAheadWindow>();

  constructor(private readonly options: ExtractorWindowOptions) {}

  /** Applies the window to `runs`; returns the ids of the runs that are too far behind `playheadSec`. */
  sync(runs: Iterable<WindowedRun>, playheadSec: number): number[] {
    const behind: number[] = [];
    for (const run of runs) {
      const lead = run.headSec - playheadSec;
      if (lead < -this.options.behindSec) {
        behind.push(run.id);
        continue;
      }
      const state = this.windows.get(run.id) ?? new ReadAheadWindow(this.options.holdSec, this.options.resumeSec);
      this.windows.set(run.id, state);
      if (state.update(lead)) this.options.setHold(run.id, state.waiting);
    }
    return behind;
  }

  isHeld(runId: number): boolean {
    return this.windows.get(runId)?.waiting ?? false;
  }

  /** The run is gone; its hold must not outlive it. */
  release(runId: number): void {
    if (this.windows.delete(runId)) this.options.setHold(runId, false);
  }
}
