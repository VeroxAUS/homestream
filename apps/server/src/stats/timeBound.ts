const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const EPOCH_MS = /^\d{1,15}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/**
 * Epoch ms, an ISO timestamp, or a local `YYYY-MM-DD` day. A day is the start of that day for `from` and its last millisecond
 * for `to`, so a date range includes its end day. Returns null for anything else.
 */
export function parseTimeBound(raw: string, edge: 'from' | 'to'): number | null {
  if (EPOCH_MS.test(raw)) return Number(raw);
  const day = DAY_ONLY.exec(raw);
  if (day) {
    const [year, month, date] = [Number(day[1]), Number(day[2]), Number(day[3])];
    const start = new Date(year, month - 1, date);
    if (start.getMonth() !== month - 1 || start.getDate() !== date) return null;
    return edge === 'from' ? start.getTime() : new Date(year, month - 1, date + 1).getTime() - 1;
  }
  if (!ISO_TIMESTAMP.test(raw)) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}
