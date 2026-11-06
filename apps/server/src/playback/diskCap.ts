/** Pure planning for the TRANSCODE_MAX_GB cap; the manager applies the plan. */

export interface DiskSession {
  id: string;
  /** Finished segment sizes by index. */
  sizes: Map<number, number>;
  /** Segment the player asked for last (or the one at its reported position). */
  playerSegment: number;
  /** Segment the encoder is currently writing. */
  headSegment: number;
  encoderRunning: boolean;
  lastActivity: number;
}

export interface DiskPlanInput {
  capBytes: number;
  sessions: DiskSession[];
  now: number;
}

export interface DiskPlan {
  evict: Map<string, number[]>;
  /** Stop the encoder but keep the files; it restarts when the player catches up. */
  park: string[];
  resume: string[];
  /** Sessions to stop completely (oldest idle first), only used when evicting segments is not enough. */
  stopIdle: string[];
}

/** Watched segments kept behind the player so small backward seeks stay instant. */
export const KEEP_BEHIND = 3;
/** Above this share of the cap the encoder is parked (leaves room for what is written before it stops). */
const PARK_RATIO = 0.8;
/** Eviction aims for this share of the cap. */
const LOW_WATER_RATIO = 0.65;
/** Parked encoders restart below this share. */
const RESUME_RATIO = 0.6;
/** Segments the encoder must be ahead of the player before it may be parked. */
const MIN_LEAD = 8;
/** A parked encoder restarts when it is less than this many segments ahead. */
const RESUME_LEAD = 30;
/** Sessions without a request for this long can be dropped to make room for others. */
export const IDLE_EVICT_MS = 30_000;

function sessionBytes(session: DiskSession): number {
  let total = 0;
  for (const size of session.sizes.values()) total += size;
  return total;
}

export function planDiskCap(input: DiskPlanInput): DiskPlan {
  const { capBytes, sessions, now } = input;
  const plan: DiskPlan = { evict: new Map(), park: [], resume: [], stopIdle: [] };
  const bytes = new Map(sessions.map((session) => [session.id, sessionBytes(session)]));
  let total = [...bytes.values()].reduce((sum, value) => sum + value, 0);
  const evicted = new Map<string, Set<number>>(sessions.map((session) => [session.id, new Set()]));

  const evictIndex = (session: DiskSession, index: number): void => {
    const size = session.sizes.get(index) ?? 0;
    (evicted.get(session.id) as Set<number>).add(index);
    bytes.set(session.id, (bytes.get(session.id) ?? 0) - size);
    total -= size;
  };

  if (total > PARK_RATIO * capBytes) {
    const byAge = [...sessions].sort((a, b) => a.lastActivity - b.lastActivity);
    for (const session of byAge) {
      const behind = [...session.sizes.keys()]
        .filter((index) => index < session.playerSegment - KEEP_BEHIND)
        .sort((a, b) => a - b);
      for (const index of behind) {
        if (total <= LOW_WATER_RATIO * capBytes) break;
        evictIndex(session, index);
      }
    }
  }

  if (total > PARK_RATIO * capBytes) {
    for (const session of sessions) {
      if (session.encoderRunning && session.headSegment - session.playerSegment >= MIN_LEAD) plan.park.push(session.id);
    }
  }

  if (total > capBytes) {
    const idle = sessions
      .filter((session) => now - session.lastActivity >= IDLE_EVICT_MS)
      .sort((a, b) => a.lastActivity - b.lastActivity);
    // Never stop the last remaining session: dropping segments is the only option for it.
    for (const session of idle) {
      if (total <= capBytes || sessions.length - plan.stopIdle.length <= 1) break;
      plan.stopIdle.push(session.id);
      total -= bytes.get(session.id) ?? 0;
      bytes.set(session.id, 0);
    }
  }

  if (total > capBytes) {
    const stopped = new Set(plan.stopIdle);
    const ranked = sessions
      .filter((session) => !stopped.has(session.id))
      .sort((a, b) => (bytes.get(b.id) ?? 0) - (bytes.get(a.id) ?? 0));
    for (const session of ranked) {
      const taken = evicted.get(session.id) as Set<number>;
      const protectedIndex = (index: number): boolean =>
        (index >= session.playerSegment && index <= session.playerSegment + 5) || index >= session.headSegment - 2;
      const candidates = [...session.sizes.keys()]
        .filter((index) => !taken.has(index) && !protectedIndex(index))
        .sort((a, b) => a - b);
      for (const index of candidates) {
        if (total <= LOW_WATER_RATIO * capBytes) break;
        evictIndex(session, index);
      }
    }
  }

  for (const [id, indices] of evicted) {
    if (indices.size > 0)
      plan.evict.set(
        id,
        [...indices].sort((a, b) => a - b),
      );
  }

  if (total < RESUME_RATIO * capBytes) {
    for (const session of sessions) {
      if (!session.encoderRunning && session.headSegment - session.playerSegment < RESUME_LEAD)
        plan.resume.push(session.id);
    }
  }
  return plan;
}
