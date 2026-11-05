import type { SubtitleStatus } from '@homestream/shared';
import { covers, firstGap, mergeIntervals, type Interval } from './intervals.js';
import { SEGMENT_SECONDS, segmentCount } from './playlist.js';
import { renderFull, renderSegment, type Cue } from './vtt.js';

/** Fewer than this many seconds uncovered at the very end of the file still counts as complete (container duration rounding). */
const END_TOLERANCE_SEC = 0.5;

/** Total order, so the same cue set always renders to the same bytes however the runs delivered it. */
function compareCues(a: Cue, b: Cue): number {
  return a.startMs - b.startMs || a.endMs - b.endMs || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0);
}

interface TrackCues {
  cues: Cue[];
  seen: Set<string>;
  sorted: boolean;
  /** Longest cue so far; bounds how far before a segment a cue can start and still reach into it. */
  maxLengthMs: number;
}

/** Cues of a session's text tracks, plus which stretches of the file have been read completely. Owned by the session, not by an encoder run. */
export class SubtitleStore {
  private readonly tracks = new Map<number, TrackCues>();
  private readonly runIntervals = new Map<number, Interval>();
  private merged: Interval[] = [];
  private failed = false;

  constructor(
    readonly durationSec: number,
    trackIndices: readonly number[],
  ) {
    for (const index of trackIndices) this.tracks.set(index, { cues: [], seen: new Set(), sorted: true, maxLengthMs: 0 });
  }

  get trackIndices(): number[] {
    return [...this.tracks.keys()];
  }

  has(track: number): boolean {
    return this.tracks.has(track);
  }

  get segmentTotal(): number {
    return segmentCount(this.durationSec);
  }

  addCues(track: number, cues: readonly Cue[]): void {
    const entry = this.tracks.get(track);
    if (!entry) return;
    for (const cue of cues) {
      const key = `${cue.startMs}|${cue.endMs}|${cue.text}`;
      if (entry.seen.has(key)) continue;
      entry.seen.add(key);
      const last = entry.cues.at(-1);
      if (last && compareCues(cue, last) < 0) entry.sorted = false;
      entry.cues.push(cue);
      entry.maxLengthMs = Math.max(entry.maxLengthMs, cue.endMs - cue.startMs);
    }
  }

  /** Records the stretch one extractor run has read completely; the store keeps the union over all runs. */
  setCoverage(runId: number, interval: Interval | null): void {
    if (interval && interval.end > interval.start) this.runIntervals.set(runId, interval);
    else this.runIntervals.delete(runId);
    this.merged = mergeIntervals([...this.runIntervals.values()]);
  }

  intervals(): Interval[] {
    return this.merged.map((item) => ({ ...item }));
  }

  /** Marks every track that is not complete as failed; segments already covered stay servable. */
  markFailed(): void {
    this.failed = true;
  }

  segmentCovered(k: number): boolean {
    const start = k * SEGMENT_SECONDS;
    return covers(this.merged, start, Math.min(start + SEGMENT_SECONDS, this.durationSec));
  }

  get complete(): boolean {
    return firstGap(this.merged, this.durationSec - END_TOLERANCE_SEC) === null;
  }

  firstGap(): Interval | null {
    return firstGap(this.merged, this.durationSec);
  }

  status(): SubtitleStatus {
    if (this.complete) return 'complete';
    return this.failed ? 'error' : 'extracting';
  }

  segment(track: number, k: number): string {
    const entry = this.tracks.get(track);
    const from = k * SEGMENT_SECONDS * 1000;
    const to = from + SEGMENT_SECONDS * 1000;
    if (!entry) return renderSegment([], from, to);
    const cues = this.sortedCues(entry);
    // Cues are ordered by start, so everything starting before `from - maxLength` ended before the segment.
    const earliest = from - entry.maxLengthMs;
    let low = 0;
    let high = cues.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((cues[mid] as Cue).startMs < earliest) low = mid + 1;
      else high = mid;
    }
    return renderSegment(cues, from, to, low);
  }

  full(track: number): string {
    const entry = this.tracks.get(track);
    return renderFull(entry ? this.sortedCues(entry) : []);
  }

  private sortedCues(entry: TrackCues): Cue[] {
    if (!entry.sorted) {
      entry.cues.sort(compareCues);
      entry.sorted = true;
    }
    return entry.cues;
  }
}
