import type { HistoryItem } from '@homestream/shared';
import type { Db } from './index.js';

interface RawPlay {
  id: number;
  session_id: string;
  media_key: string;
  type: 'movie' | 'tv';
  tmdb_id: number;
  title: string;
  show_title: string | null;
  season: number | null;
  episode: number | null;
  device_id: string | null;
  device_name: string | null;
  device_kind: string | null;
  client_ip: string | null;
  started_at: number;
  ended_at: number | null;
  watched_sec: number;
  last_position_sec: number;
  duration_sec: number;
  completed: number;
  stream_filename: string | null;
  source_resolution: string | null;
  source_codec: string | null;
  source_hdr: string | null;
  source_audio: string | null;
  decision_json: string | null;
  avg_bitrate_kbps: number | null;
  avg_speed: number | null;
  bytes_served: number;
  status: 'ok' | 'error';
  error_message: string | null;
}

/** The server writes the decision, but rows seeded by hand may carry only part of it, so it is passed on as stored. */
function parseDecision(json: string | null): HistoryItem['decision'] {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as HistoryItem['decision']) : null;
  } catch {
    return null;
  }
}

function toHistoryItem(raw: RawPlay): HistoryItem {
  return {
    id: raw.id,
    sessionId: raw.session_id,
    mediaKey: raw.media_key,
    type: raw.type,
    tmdbId: raw.tmdb_id,
    title: raw.title,
    showTitle: raw.show_title,
    season: raw.season,
    episode: raw.episode,
    deviceId: raw.device_id,
    deviceName: raw.device_name,
    deviceKind: raw.device_kind as HistoryItem['deviceKind'],
    clientIp: raw.client_ip,
    startedAt: raw.started_at,
    endedAt: raw.ended_at,
    watchedSec: raw.watched_sec,
    lastPositionSec: raw.last_position_sec,
    durationSec: raw.duration_sec,
    completed: raw.completed === 1,
    streamFilename: raw.stream_filename,
    sourceResolution: raw.source_resolution,
    sourceCodec: raw.source_codec,
    sourceHdr: raw.source_hdr,
    sourceAudio: raw.source_audio,
    decision: parseDecision(raw.decision_json),
    avgBitrateKbps: raw.avg_bitrate_kbps,
    avgSpeed: raw.avg_speed,
    bytesServed: raw.bytes_served,
    status: raw.status,
    errorMessage: raw.error_message,
  };
}

export interface HistoryFilter {
  type?: 'movie' | 'tv';
  deviceId?: string;
  q?: string;
  /** Epoch ms, inclusive. */
  from?: number;
  to?: number;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function where(filter: HistoryFilter): { sql: string; params: Array<string | number> } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.type) {
    clauses.push('type = ?');
    params.push(filter.type);
  }
  if (filter.deviceId) {
    clauses.push('device_id = ?');
    params.push(filter.deviceId);
  }
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q)}%`;
    clauses.push("(title LIKE ? ESCAPE '\\' OR show_title LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  if (filter.from !== undefined) {
    clauses.push('started_at >= ?');
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    clauses.push('started_at <= ?');
    params.push(filter.to);
  }
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** Newest first; `id` breaks ties so pages never overlap. */
export function queryHistory(
  db: Db,
  filter: HistoryFilter,
  limit: number,
  offset: number,
): { items: HistoryItem[]; total: number } {
  const { sql, params } = where(filter);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM plays ${sql}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`SELECT * FROM plays ${sql} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as RawPlay[];
  return { items: rows.map(toHistoryItem), total };
}

export function playsStartedSince(db: Db, sinceMs: number): HistoryItem[] {
  const rows = db
    .prepare('SELECT * FROM plays WHERE started_at >= ? ORDER BY started_at DESC, id DESC')
    .all(sinceMs) as unknown as RawPlay[];
  return rows.map(toHistoryItem);
}

export interface WatchedBase {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
}

/** The movie or show of the most recent play with at least `minWatchedSec` watched, and every title that qualifies. */
export function watchedTitles(db: Db, minWatchedSec: number): { latest: WatchedBase | null; played: Set<string> } {
  const newest = db
    .prepare(
      'SELECT type, tmdb_id, title, show_title FROM plays WHERE watched_sec >= ? ORDER BY started_at DESC, id DESC LIMIT 1',
    )
    .get(minWatchedSec) as
    { type: 'movie' | 'tv'; tmdb_id: number; title: string; show_title: string | null } | undefined;
  if (!newest) return { latest: null, played: new Set() };
  const titles = db
    .prepare('SELECT DISTINCT type, tmdb_id FROM plays WHERE watched_sec >= ?')
    .all(minWatchedSec) as unknown as Array<{
    type: 'movie' | 'tv';
    tmdb_id: number;
  }>;
  return {
    latest: {
      mediaType: newest.type,
      tmdbId: newest.tmdb_id,
      title: newest.type === 'tv' ? newest.show_title || newest.title : newest.title,
    },
    played: new Set(titles.map((row) => `${row.type}:${row.tmdb_id}`)),
  };
}
