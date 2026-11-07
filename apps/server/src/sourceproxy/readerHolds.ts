import { ReadAheadWindow, type ReadAheadState } from '../network/readAhead.js';

interface OwnerReaders {
  token: string;
  lead: number;
  window: ReadAheadWindow;
  /** Extractor runs of this owner (by the owner's own run id) whose reads wait at the end of their window. */
  heldRuns: Set<number>;
}

/**
 * Read-ahead state of every owner reading one shared source. The byte cache is shared, but each session gates its own
 * readers: a session that is a full window ahead stops downloading while another one on the same stream keeps filling.
 * Readers tell the owners apart by an opaque token in their loopback URL, so extractor run ids of different sessions
 * never collide.
 */
export class ReaderHolds {
  private readonly owners = new Map<string, OwnerReaders>();
  private readonly byToken = new Map<string, string>();

  constructor(
    private readonly holdAtSec: number,
    private readonly resumeSec: number,
    private readonly newToken: () => string,
    /** Called when a hold may have been released. */
    private readonly onRelease: () => void,
  ) {}

  tokenFor(owner: string): string {
    return this.ensure(owner).token;
  }

  ownerOf(token: string): string | null {
    return this.byToken.get(token) ?? null;
  }

  setLead(owner: string, leadSec: number): void {
    const readers = this.ensure(owner);
    readers.lead = leadSec;
    if (readers.window.update(leadSec)) this.onRelease();
  }

  /** A start, seek or encoder restart: measured from here, so the next stretch downloads freely again. */
  reset(owner: string): void {
    const readers = this.ensure(owner);
    readers.lead = 0;
    readers.window.reset();
    this.onRelease();
  }

  leadOf(owner: string): number {
    return this.owners.get(owner)?.lead ?? 0;
  }

  /** The smallest lead of any owner, or 0 without owners. */
  minLead(): number {
    let min: number | null = null;
    for (const { lead } of this.owners.values()) min = min === null ? lead : Math.min(min, lead);
    return min ?? 0;
  }

  stateOf(owner: string): ReadAheadState {
    return this.owners.get(owner)?.window.state ?? 'filling';
  }

  setExtractorHold(owner: string, runId: number, held: boolean): void {
    const { heldRuns } = this.ensure(owner);
    if (held === heldRuns.has(runId)) return;
    if (held) heldRuns.add(runId);
    else {
      heldRuns.delete(runId);
      this.onRelease();
    }
  }

  /** Reads without a known owner (probes, the plain extractor URL) are never held. */
  isHeld(consumer: 'main' | 'extractor', owner: string | null, runId: number | null): boolean {
    const readers = owner === null ? undefined : this.owners.get(owner);
    if (!readers) return false;
    return consumer === 'main' ? readers.window.waiting : runId !== null && readers.heldRuns.has(runId);
  }

  forget(owner: string): void {
    const readers = this.owners.get(owner);
    if (!readers) return;
    this.owners.delete(owner);
    this.byToken.delete(readers.token);
    this.onRelease();
  }

  private ensure(owner: string): OwnerReaders {
    let readers = this.owners.get(owner);
    if (!readers) {
      readers = {
        token: this.newToken(),
        lead: 0,
        window: new ReadAheadWindow(this.holdAtSec, this.resumeSec),
        heldRuns: new Set(),
      };
      this.owners.set(owner, readers);
      this.byToken.set(readers.token, owner);
    }
    return readers;
  }
}
