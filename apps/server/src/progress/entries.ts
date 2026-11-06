import type { ProgressRow } from '../db/progress.js';
import { isResumable } from './rules.js';

export interface ContinueEntry {
  row: ProgressRow;
  /** `resume`: show the row itself. `completed`: a show's latest episode is done, so its next episode is the entry. */
  kind: 'resume' | 'completed';
}

function eligible(row: ProgressRow): boolean {
  return row.hidden || row.completed || isResumable(row.positionSec, false);
}

/**
 * The titles that may appear in Continue Watching, newest first. A movie is one entry; a show is one entry, its most recent
 * eligible episode. A removed row takes part in that choice, so removing a show's entry is not undone by an older episode.
 * Finished movies and removed rows produce no entry.
 */
export function selectEntries(rows: ProgressRow[]): ContinueEntry[] {
  const newest = new Map<string, ProgressRow>();
  for (const row of rows) {
    if (!eligible(row)) continue;
    const group = row.type === 'movie' ? row.mediaKey : `tv:${row.tmdbId}`;
    const best = newest.get(group);
    if (!best || row.updatedAt > best.updatedAt || (row.updatedAt === best.updatedAt && row.mediaKey < best.mediaKey)) {
      newest.set(group, row);
    }
  }
  const entries: ContinueEntry[] = [];
  for (const row of newest.values()) {
    if (row.hidden) continue;
    if (row.completed) {
      if (row.type === 'tv' && row.season !== null && row.episode !== null) entries.push({ row, kind: 'completed' });
      continue;
    }
    entries.push({ row, kind: 'resume' });
  }
  return entries.sort((a, b) => b.row.updatedAt - a.row.updatedAt || (a.row.mediaKey < b.row.mediaKey ? -1 : 1));
}
