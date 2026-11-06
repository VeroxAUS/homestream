const SLOT_MS = 250;
const SLOTS = 80;

/**
 * Bytes per time over a sliding window, kept in 250 ms slots so a reading costs a few dozen additions and an add costs one.
 * Time comes from the caller.
 */
export class RateMeter {
  private readonly bytes = new Float64Array(SLOTS);
  private readonly slotIds = new Float64Array(SLOTS).fill(-1);
  private total = 0;

  add(bytes: number, nowMs: number): void {
    const id = Math.floor(nowMs / SLOT_MS);
    const slot = id % SLOTS;
    if (this.slotIds[slot] !== id) {
      this.slotIds[slot] = id;
      this.bytes[slot] = 0;
    }
    this.bytes[slot] = (this.bytes[slot] as number) + bytes;
    this.total += bytes;
  }

  /** Every byte ever added. */
  get totalBytes(): number {
    return this.total;
  }

  /** Bytes added during the `windowMs` that end at `nowMs` (to slot precision). */
  bytesIn(windowMs: number, nowMs: number): number {
    const current = Math.floor(nowMs / SLOT_MS);
    const oldest = current - Math.min(SLOTS - 1, Math.max(1, Math.round(windowMs / SLOT_MS)) - 1);
    let sum = 0;
    for (let id = oldest; id <= current; id += 1) {
      const slot = ((id % SLOTS) + SLOTS) % SLOTS;
      if (this.slotIds[slot] === id) sum += this.bytes[slot] as number;
    }
    return sum;
  }

  /** Average megabits per second over the window. */
  mbps(windowMs: number, nowMs: number): number {
    const slots = Math.min(SLOTS - 1, Math.max(1, Math.round(windowMs / SLOT_MS)));
    // The newest slot is only partly elapsed, so the span is the whole older slots plus that part.
    const spanMs = (slots - 1) * SLOT_MS + Math.max(1, nowMs - Math.floor(nowMs / SLOT_MS) * SLOT_MS);
    return (this.bytesIn(windowMs, nowMs) * 8) / 1000 / spanMs;
  }
}
