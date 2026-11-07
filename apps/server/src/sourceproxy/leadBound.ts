/** Who a reader is. One object stands for one loopback request for its whole life. */
export interface LeadReader {
  consumer: 'main' | 'extractor';
  owner: string | null;
  runId: number | null;
}

interface Tracked {
  pos: number;
  /** Order of the latest move; the encoder front is the position of the main reader that moved last. */
  seq: number;
  held: boolean;
}

/**
 * Keeps a session's subtitle extractor from getting further ahead of its encoder than the block cache can hold. The two
 * read the same cache; a gap larger than the cache evicts bytes the encoder has yet to read and downloads them twice.
 *
 * An extractor run is held once its read position is more than `holdBytes` past the encoder's front, and released when
 * the gap is down to `resumeBytes`, so it works in bursts instead of one block per encoder block. It is never held while
 * its session has no encoder reader (a restart, a seek, a plain file): there is nothing to stay close to.
 * Only readers that carry a session token are tracked, and extractors only with their run id.
 */
export class ExtractorLeadBound {
  private readonly owners = new Map<string, Map<LeadReader, Tracked>>();
  private seq = 0;

  constructor(
    private readonly holdBytes: number,
    private readonly resumeBytes: number,
    /** Called when a held extractor may go on. */
    private readonly onRelease: () => void,
  ) {}

  open(reader: LeadReader, pos: number): void {
    if (reader.owner === null || !this.tracks(reader)) return;
    let readers = this.owners.get(reader.owner);
    if (!readers) {
      readers = new Map();
      this.owners.set(reader.owner, readers);
    }
    readers.set(reader, { pos, seq: (this.seq += 1), held: false });
    this.settle(readers, reader);
  }

  advance(reader: LeadReader, pos: number): void {
    const readers = this.readersOf(reader);
    const tracked = readers?.get(reader);
    if (!readers || !tracked) return;
    tracked.pos = pos;
    if (reader.consumer === 'main') tracked.seq = this.seq += 1;
    this.settle(readers, reader);
  }

  close(reader: LeadReader): void {
    const readers = this.readersOf(reader);
    if (!readers?.delete(reader) || reader.owner === null) return;
    if (readers.size === 0) this.owners.delete(reader.owner);
    else this.settle(readers, null);
  }

  isHeld(reader: LeadReader): boolean {
    return reader.consumer === 'extractor' && (this.readersOf(reader)?.get(reader)?.held ?? false);
  }
  forget(owner: string): void {
    const readers = this.owners.get(owner);
    if (!readers) return;
    this.owners.delete(owner);
    for (const tracked of readers.values()) {
      if (tracked.held) {
        this.onRelease();
        return;
      }
    }
  }

  private readersOf(reader: LeadReader): Map<LeadReader, Tracked> | undefined {
    return reader.owner === null ? undefined : this.owners.get(reader.owner);
  }

  private tracks(reader: LeadReader): boolean {
    return reader.consumer === 'main' || reader.runId !== null;
  }

  /** Re-checks the extractors of one owner after `moved` (an extractor, or null when the front changed) changed. */
  private settle(readers: Map<LeadReader, Tracked>, moved: LeadReader | null): void {
    let front: number | null = null;
    let latest = -1;
    for (const [reader, tracked] of readers) {
      if (reader.consumer === 'main' && tracked.seq > latest) {
        latest = tracked.seq;
        front = tracked.pos;
      }
    }
    let released = false;
    for (const [reader, tracked] of readers) {
      if (reader.consumer !== 'extractor' || (moved?.consumer === 'extractor' && moved !== reader)) continue;
      if (front === null) {
        released ||= tracked.held;
        tracked.held = false;
        continue;
      }
      const gap = tracked.pos - front;
      if (!tracked.held && gap > this.holdBytes) tracked.held = true;
      else if (tracked.held && gap <= this.resumeBytes) {
        tracked.held = false;
        released = true;
      }
    }
    if (released) this.onRelease();
  }
}
