/** Half-open range of source seconds. `end` may be Infinity. */
export interface Interval {
  start: number;
  end: number;
}

/** Union of the ranges, sorted; ranges that touch or overlap (within `gap` seconds) become one. */
export function mergeIntervals(intervals: readonly Interval[], gap = 0): Interval[] {
  const sorted = intervals.filter((item) => item.end > item.start).map((item) => ({ ...item })).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const item of sorted) {
    const last = merged.at(-1);
    if (last && item.start <= last.end + gap) last.end = Math.max(last.end, item.end);
    else merged.push(item);
  }
  return merged;
}

/** True when [start, end) lies inside one merged interval. */
export function covers(merged: readonly Interval[], start: number, end: number): boolean {
  return merged.some((item) => item.start <= start && item.end >= end);
}

/** The first stretch of [0, total) that the merged intervals leave open, or null when nothing is missing. */
export function firstGap(merged: readonly Interval[], total: number): Interval | null {
  let cursor = 0;
  for (const item of merged) {
    if (item.start > cursor) return { start: cursor, end: Math.min(item.start, total) };
    cursor = Math.max(cursor, item.end);
    if (cursor >= total) return null;
  }
  return cursor < total ? { start: cursor, end: total } : null;
}
