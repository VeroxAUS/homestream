import type { Db } from '../db/index.js';
import { redact, redactDeep } from '../redact.js';
import type { EventBus } from './bus.js';

export type EventLevel = 'info' | 'warn' | 'error';
export type EventSource =
  'gateway' | 'tmdb' | 'torbox' | 'ffmpeg' | 'session' | 'health' | 'server' | 'prefetch' | 'downloads';

export interface LogEventInput {
  level: EventLevel;
  source: EventSource;
  message: string;
  details?: Record<string, unknown>;
  sessionId?: string | null;
}

export interface EventRow {
  id: number;
  ts: number;
  level: EventLevel;
  source: EventSource;
  message: string;
  details: Record<string, unknown> | null;
  sessionId: string | null;
}

const MAX_ROWS = 10_000;
const RETENTION_MS = 30 * 24 * 3600 * 1000;
let writesSincePrune = 0;

/** Persists a redacted event row and pushes it to SSE subscribers as a `log` event. */
export function logEvent(deps: { db: Db; bus: EventBus }, input: LogEventInput): EventRow {
  const ts = Date.now();
  const message = redact(input.message);
  const details = input.details ? redactDeep(input.details) : null;
  const result = deps.db
    .prepare('INSERT INTO events (ts, level, source, message, details_json, session_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ts, input.level, input.source, message, details ? JSON.stringify(details) : null, input.sessionId ?? null);
  const row: EventRow = {
    id: Number(result.lastInsertRowid),
    ts,
    level: input.level,
    source: input.source,
    message,
    details,
    sessionId: input.sessionId ?? null,
  };
  deps.bus.emit('log', { ...row });

  writesSincePrune += 1;
  if (writesSincePrune >= 200) {
    writesSincePrune = 0;
    pruneEvents(deps.db, ts);
  }
  return row;
}

function pruneEvents(db: Db, now = Date.now()): void {
  db.prepare('DELETE FROM events WHERE ts < ?').run(now - RETENTION_MS);
  db.prepare('DELETE FROM events WHERE id <= (SELECT id FROM events ORDER BY id DESC LIMIT 1 OFFSET ?)').run(MAX_ROWS);
}
