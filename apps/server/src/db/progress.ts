import type { Db } from './index.js';

interface ProgressMeta {
  title?: string;
  showTitle?: string | null;
  episodeTitle?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
}

export interface ProgressRow {
  mediaKey: string;
  tmdbId: number;
  type: 'movie' | 'tv';
  season: number | null;
  episode: number | null;
  positionSec: number;
  durationSec: number;
  updatedAt: number;
  completed: boolean;
  /** Removed from Continue Watching by the user; a new ping brings the title back. */
  hidden: boolean;
  meta: ProgressMeta;
}

interface RawRow {
  media_key: string;
  tmdb_id: number;
  type: 'movie' | 'tv';
  season: number | null;
  episode: number | null;
  position_sec: number;
  duration_sec: number;
  updated_at: number;
  completed: number;
  hidden: number;
  meta_json: string;
}

function parseMeta(json: string): ProgressMeta {
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as ProgressMeta) : {};
  } catch {
    return {};
  }
}

function toRow(raw: RawRow): ProgressRow {
  return {
    mediaKey: raw.media_key,
    tmdbId: raw.tmdb_id,
    type: raw.type,
    season: raw.season,
    episode: raw.episode,
    positionSec: raw.position_sec,
    durationSec: raw.duration_sec,
    updatedAt: raw.updated_at,
    completed: raw.completed === 1,
    hidden: raw.hidden === 1,
    meta: parseMeta(raw.meta_json),
  };
}

export function getProgress(db: Db, mediaKey: string): ProgressRow | null {
  const raw = db.prepare('SELECT * FROM progress WHERE media_key = ?').get(mediaKey) as RawRow | undefined;
  return raw ? toRow(raw) : null;
}

export type ProgressWrite = Omit<ProgressRow, 'hidden'>;

export function upsertProgress(db: Db, row: ProgressWrite): void {
  db.prepare(
    `INSERT INTO progress (media_key, tmdb_id, type, season, episode, position_sec, duration_sec, updated_at, completed, hidden, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(media_key) DO UPDATE SET
       position_sec = excluded.position_sec,
       duration_sec = excluded.duration_sec,
       updated_at = excluded.updated_at,
       completed = excluded.completed,
       hidden = 0,
       meta_json = excluded.meta_json`,
  ).run(
    row.mediaKey,
    row.tmdbId,
    row.type,
    row.season,
    row.episode,
    row.positionSec,
    row.durationSec,
    row.updatedAt,
    row.completed ? 1 : 0,
    JSON.stringify(row.meta),
  );
}

/** Saved episodes of one show, by season and episode. Removed-from-row markers (position 0, not completed) are left out. */
export function listShowProgress(db: Db, tmdbId: number): ProgressRow[] {
  const rows = db
    .prepare(
      "SELECT * FROM progress WHERE type = 'tv' AND tmdb_id = ? AND season IS NOT NULL AND episode IS NOT NULL AND (position_sec > 0 OR completed = 1) ORDER BY season ASC, episode ASC",
    )
    .all(tmdbId) as unknown as RawRow[];
  return rows.map(toRow);
}

/**
 * Rows that can appear in Continue Watching: resumable, completed (their next episode may show) or removed by the user
 * (the removal has to win against older rows of the same show). Newest first.
 */
export function listEligibleProgress(db: Db): ProgressRow[] {
  const rows = db
    .prepare(
      'SELECT * FROM progress WHERE hidden = 1 OR completed = 1 OR position_sec >= 60 ORDER BY updated_at DESC, media_key ASC',
    )
    .all() as unknown as RawRow[];
  return rows.map(toRow);
}

/** Returns false when no row has that key. */
export function setProgressHidden(db: Db, mediaKey: string, hidden: boolean, now: number): boolean {
  const result = db
    .prepare('UPDATE progress SET hidden = ?, updated_at = ? WHERE media_key = ? AND hidden != ?')
    .run(hidden ? 1 : 0, now, mediaKey, hidden ? 1 : 0);
  return Number(result.changes) > 0;
}

/** A removed "Up next" entry has no progress yet; this row records the removal. */
export function insertHiddenMarker(
  db: Db,
  marker: { mediaKey: string; tmdbId: number; season: number; episode: number; now: number },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO progress (media_key, tmdb_id, type, season, episode, position_sec, duration_sec, updated_at, completed, hidden, meta_json)
     VALUES (?, ?, 'tv', ?, ?, 0, 0, ?, 0, 1, '{}')`,
  ).run(marker.mediaKey, marker.tmdbId, marker.season, marker.episode, marker.now);
}
