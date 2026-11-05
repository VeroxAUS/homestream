import { planDiskCap, type DiskSession } from './diskCap.js';
import type { SessionRecord } from './session.js';
import { bitrateKbpsFromSegments } from './stats.js';

/** Segments averaged for the bitrate reading. */
const BITRATE_WINDOW = 10;

export interface MonitorHost {
  liveSessions(): SessionRecord[];
  /** Live sessions plus failed ones that still await cleanup. */
  allSessions(): SessionRecord[];
  /** Ends sessions that have had no activity for too long. */
  stopIdle(rec: SessionRecord): Promise<void>;
  /** Ends a session to free disk space for others. */
  stopForDisk(rec: SessionRecord): Promise<void>;
  park(rec: SessionRecord): Promise<void>;
  resume(rec: SessionRecord): Promise<void>;
  publish(rec: SessionRecord): void;
}

export interface MonitorOptions {
  idleTimeoutMs: number;
  capBytes: number;
}

/**
 * Periodic housekeeping for live sessions: idle timeout, encoder bitrate from finished segments, the disk cap,
 * and the `session.update` pushes.
 */
export class SessionMonitor {
  private running = false;

  constructor(
    private readonly host: MonitorHost,
    private readonly options: MonitorOptions,
  ) {}

  async tick(now = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(now);
    } finally {
      this.running = false;
    }
  }

  private async sweep(now: number): Promise<void> {
    for (const rec of this.host.allSessions()) {
      if (now - rec.lastActivity >= this.options.idleTimeoutMs) await this.host.stopIdle(rec);
    }

    const live = this.host.liveSessions();
    await Promise.all(live.map((rec) => rec.store.refresh()));
    for (const rec of live) this.updateBitrate(rec);
    await this.enforceDiskCap(live, now);

    for (const rec of this.host.liveSessions()) {
      if (rec.state !== 'error') this.host.publish(rec);
    }
  }

  private updateBitrate(rec: SessionRecord): void {
    const last = rec.stats.headSegment - 1;
    const first = Math.max(rec.startSegment, last - BITRATE_WINDOW + 1);
    const sizes: number[] = [];
    for (let index = first; index <= last; index += 1) {
      const size = rec.store.sizes.get(index);
      if (size !== undefined) sizes.push(size);
    }
    const bitrate = bitrateKbpsFromSegments(sizes);
    if (bitrate <= 0) return;
    rec.stats = { ...rec.stats, bitrateKbps: bitrate };
    rec.statSamples.bitrateSum += bitrate;
    rec.statSamples.bitrateCount += 1;
  }

  private async enforceDiskCap(live: SessionRecord[], now: number): Promise<void> {
    const byId = new Map(live.map((rec) => [rec.id, rec]));
    const sessions: DiskSession[] = live.map((rec) => ({
      id: rec.id,
      sizes: rec.store.sizes,
      playerSegment: rec.playerSegment,
      headSegment: rec.stats.headSegment,
      encoderRunning: !!rec.process?.running,
      lastActivity: rec.lastActivity,
    }));
    const plan = planDiskCap({ capBytes: this.options.capBytes, sessions, now });

    for (const [id, indices] of plan.evict) await byId.get(id)?.store.remove(indices);
    for (const id of plan.stopIdle) {
      const rec = byId.get(id);
      if (rec) await this.host.stopForDisk(rec);
    }
    for (const id of plan.park) {
      const rec = byId.get(id);
      if (rec && !plan.stopIdle.includes(id)) await this.host.park(rec);
    }
    for (const id of plan.resume) {
      const rec = byId.get(id);
      if (rec?.parked && !plan.stopIdle.includes(id)) await this.host.resume(rec);
    }
  }
}
