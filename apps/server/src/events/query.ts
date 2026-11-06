import type { LogEvent } from '@homestream/shared';
import type { Db } from '../db/index.js';
import { redact, redactDeep } from '../redact.js';
import type { EventLevel, EventSource } from './record.js';

interface EventDbRow {
  id: number;
  ts: number;
  level: EventLevel;
  source: EventSource;
  message: string;
  details_json: string | null;
  session_id: string | null;
}

function parseDetails(json: string | null): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (redactDeep(parsed) as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function toLogEvent(row: EventDbRow): LogEvent {
  const event: LogEvent = {
    id: row.id,
    ts: row.ts,
    level: row.level,
    source: row.source,
    message: redact(row.message),
  };
  const details = parseDetails(row.details_json);
  if (details) event.details = details;
  if (row.session_id) event.sessionId = row.session_id;
  return event;
}

export interface EventFilter {
  level?: EventLevel;
  source?: EventSource;
  limit: number;
}

/** Newest first. Rows are redacted again on the way out, so rows written before a secret was registered are covered too. */
export function queryEvents(db: Db, filter: EventFilter): LogEvent[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.level) {
    where.push('level = ?');
    params.push(filter.level);
  }
  if (filter.source) {
    where.push('source = ?');
    params.push(filter.source);
  }
  const sql = `SELECT id, ts, level, source, message, details_json, session_id FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
  return (db.prepare(sql).all(...params, filter.limit) as unknown as EventDbRow[]).map(toLogEvent);
}

/**
 * Error events from playback (encoder, ffmpeg, stream link) since `sinceMs`. Rows written by the health checks themselves
 * carry `details.check` and are left out, otherwise a failed health check would show up as a failed session.
 */
export function recentSessionErrors(db: Db, sinceMs: number, limit = 5): LogEvent[] {
  const rows = db
    .prepare(
      `SELECT id, ts, level, source, message, details_json, session_id FROM events
       WHERE level = 'error' AND source IN ('session', 'ffmpeg') AND ts >= ?
         AND (details_json IS NULL OR details_json NOT LIKE '%"check":%')
       ORDER BY id DESC LIMIT ?`,
    )
    .all(sinceMs, limit) as unknown as EventDbRow[];
  return rows.map(toLogEvent);
}

export function countSessionErrors(db: Db, sinceMs: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM events
       WHERE level = 'error' AND source IN ('session', 'ffmpeg') AND ts >= ?
         AND (details_json IS NULL OR details_json NOT LIKE '%"check":%')`,
    )
    .get(sinceMs) as unknown as { n: number };
  return row.n;
}
