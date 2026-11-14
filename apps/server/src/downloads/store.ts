import type { DownloadFailureReason, DownloadState, DownloadStatus, MediaType } from '@homestream/shared';
import type { Db } from '../db/index.js';

export interface DownloadRow {
  id: string;
  mediaKey: string;
  mediaType: MediaType;
  tmdbId: number;
  season: number | null;
  episode: number | null;
  /** Gateway lookup key (`movie:tt..` / `tv:tt..:s:e`): the playback link is re-resolved from it, never stored. */
  queryKey: string;
  title: string;
  infoHash: string | null;
  status: DownloadStatus;
  state: DownloadState;
  progress: number;
  etaSec: number | null;
  reason: DownloadFailureReason | null;
  createdAt: number;
  updatedAt: number;
  nextPollAt: number;
  progressChangedAt: number;
  lastEventAt: number | null;
  /** Set when TorBox reported the item finished; the row then waits for a cached stream to show up. */
  readySince: number | null;
  notifiedAt: number | null;
  /** First poll at which TorBox did not list the hash; null while it is listed. */
  absentSince: number | null;
  /** First poll at which TorBox reported the item in metaDL with no progress since; null otherwise. */
  metadataSince: number | null;
}

interface RawRow {
  id: string;
  media_key: string;
  media_type: MediaType;
  tmdb_id: number;
  season: number | null;
  episode: number | null;
  query_key: string;
  title: string;
  info_hash: string | null;
  status: DownloadStatus;
  state: DownloadState;
  progress: number;
  eta_sec: number | null;
  reason: DownloadFailureReason | null;
  created_at: number;
  updated_at: number;
  next_poll_at: number;
  progress_changed_at: number;
  last_event_at: number | null;
  ready_since: number | null;
  notified_at: number | null;
  absent_since: number | null;
  metadata_since: number | null;
}

const COLUMNS = `id, media_key, media_type, tmdb_id, season, episode, query_key, title, info_hash, status, state, progress,
  eta_sec, reason, created_at, updated_at, next_poll_at, progress_changed_at, last_event_at, ready_since, notified_at,
  absent_since, metadata_since`;

function toRow(raw: RawRow): DownloadRow {
  return {
    id: raw.id,
    mediaKey: raw.media_key,
    mediaType: raw.media_type,
    tmdbId: raw.tmdb_id,
    season: raw.season,
    episode: raw.episode,
    queryKey: raw.query_key,
    title: raw.title,
    infoHash: raw.info_hash,
    status: raw.status,
    state: raw.state,
    progress: raw.progress,
    etaSec: raw.eta_sec,
    reason: raw.reason,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    nextPollAt: raw.next_poll_at,
    progressChangedAt: raw.progress_changed_at,
    lastEventAt: raw.last_event_at,
    readySince: raw.ready_since,
    notifiedAt: raw.notified_at,
    absentSince: raw.absent_since,
    metadataSince: raw.metadata_since,
  };
}

export type NewDownload = Pick<
  DownloadRow,
  | 'id'
  | 'mediaKey'
  | 'mediaType'
  | 'tmdbId'
  | 'season'
  | 'episode'
  | 'queryKey'
  | 'title'
  | 'infoHash'
  | 'state'
  | 'createdAt'
  | 'nextPollAt'
>;

export type DownloadPatch = Partial<
  Pick<
    DownloadRow,
    | 'status'
    | 'state'
    | 'progress'
    | 'etaSec'
    | 'reason'
    | 'nextPollAt'
    | 'progressChangedAt'
    | 'lastEventAt'
    | 'readySince'
    | 'notifiedAt'
    | 'absentSince'
    | 'metadataSince'
  >
>;

const PATCH_COLUMNS: Record<keyof DownloadPatch, string> = {
  status: 'status',
  state: 'state',
  progress: 'progress',
  etaSec: 'eta_sec',
  reason: 'reason',
  nextPollAt: 'next_poll_at',
  progressChangedAt: 'progress_changed_at',
  lastEventAt: 'last_event_at',
  readySince: 'ready_since',
  notifiedAt: 'notified_at',
  absentSince: 'absent_since',
  metadataSince: 'metadata_since',
};

const KEEP_FINISHED_MS = 30 * 24 * 3600 * 1000;

export class DownloadStore {
  constructor(private readonly db: Db) {}

  /** Throws on the unique index when the title already has a pending row. */
  insert(download: NewDownload): DownloadRow {
    this.db
      .prepare(
        `INSERT INTO pending_downloads (id, media_key, media_type, tmdb_id, season, episode, query_key, title, info_hash,
           status, state, progress, created_at, updated_at, next_poll_at, progress_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?, ?)`,
      )
      .run(
        download.id,
        download.mediaKey,
        download.mediaType,
        download.tmdbId,
        download.season,
        download.episode,
        download.queryKey,
        download.title,
        download.infoHash,
        download.state,
        download.createdAt,
        download.createdAt,
        download.nextPollAt,
        download.createdAt,
      );
    return this.get(download.id) as DownloadRow;
  }

  get(id: string): DownloadRow | null {
    const raw = this.db.prepare(`SELECT ${COLUMNS} FROM pending_downloads WHERE id = ?`).get(id) as RawRow | undefined;
    return raw ? toRow(raw) : null;
  }

  pendingForTitle(mediaKey: string): DownloadRow | null {
    const raw = this.db
      .prepare(`SELECT ${COLUMNS} FROM pending_downloads WHERE media_key = ? AND status = 'pending'`)
      .get(mediaKey) as RawRow | undefined;
    return raw ? toRow(raw) : null;
  }

  pendingForShow(tmdbId: number): DownloadRow[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM pending_downloads WHERE media_type = 'tv' AND tmdb_id = ? AND status = 'pending' ORDER BY created_at DESC`,
      )
      .all(tmdbId) as unknown as RawRow[];
    return rows.map(toRow);
  }

  /** Newest first. */
  list(): DownloadRow[] {
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM pending_downloads ORDER BY created_at DESC, rowid DESC`)
      .all() as unknown as RawRow[];
    return rows.map(toRow);
  }

  listPending(): DownloadRow[] {
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM pending_downloads WHERE status = 'pending' ORDER BY created_at ASC`)
      .all() as unknown as RawRow[];
    return rows.map(toRow);
  }

  unnotifiedReady(): DownloadRow[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM pending_downloads WHERE status = 'ready' AND notified_at IS NULL ORDER BY created_at ASC`,
      )
      .all() as unknown as RawRow[];
    return rows.map(toRow);
  }

  update(id: string, patch: DownloadPatch, now: number): void {
    const keys = (Object.keys(patch) as Array<keyof DownloadPatch>).filter((key) => patch[key] !== undefined);
    const assignments = keys.map((key) => `${PATCH_COLUMNS[key]} = ?`);
    const values = keys.map((key) => patch[key] as string | number | null);
    this.db
      .prepare(`UPDATE pending_downloads SET ${[...assignments, 'updated_at = ?'].join(', ')} WHERE id = ?`)
      .run(...values, now, id);
  }

  /** Stops tracking: the row disappears. Returns false when the id is unknown. */
  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM pending_downloads WHERE id = ?').run(id).changes) > 0;
  }

  pruneFinished(now: number): void {
    this.db
      .prepare(`DELETE FROM pending_downloads WHERE status != 'pending' AND updated_at < ?`)
      .run(now - KEEP_FINISHED_MS);
  }
}
