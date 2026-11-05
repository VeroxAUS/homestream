export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE progress (
        media_key TEXT PRIMARY KEY,
        tmdb_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('movie', 'tv')),
        season INTEGER,
        episode INTEGER,
        position_sec REAL NOT NULL DEFAULT 0,
        duration_sec REAL NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0,
        meta_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_progress_updated ON progress (updated_at DESC);
      CREATE INDEX idx_progress_tmdb ON progress (tmdb_id);

      CREATE TABLE plays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        media_key TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('movie', 'tv')),
        tmdb_id INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        show_title TEXT,
        season INTEGER,
        episode INTEGER,
        device_id TEXT,
        device_name TEXT,
        device_kind TEXT,
        client_ip TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        watched_sec REAL NOT NULL DEFAULT 0,
        last_position_sec REAL NOT NULL DEFAULT 0,
        duration_sec REAL NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0,
        stream_filename TEXT,
        source_resolution TEXT,
        source_codec TEXT,
        source_hdr TEXT,
        source_audio TEXT,
        decision_json TEXT,
        avg_bitrate_kbps REAL,
        avg_speed REAL,
        bytes_served INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
        error_message TEXT
      );
      CREATE INDEX idx_plays_started ON plays (started_at DESC);
      CREATE INDEX idx_plays_media ON plays (media_key);
      CREATE INDEX idx_plays_device ON plays (device_id);

      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('tv', 'desktop', 'web')),
        capabilities TEXT NOT NULL,
        last_ip TEXT,
        last_seen INTEGER NOT NULL
      );

      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
        source TEXT NOT NULL CHECK (source IN ('gateway', 'tmdb', 'torbox', 'ffmpeg', 'session', 'health', 'server')),
        message TEXT NOT NULL,
        details_json TEXT,
        session_id TEXT
      );
      CREATE INDEX idx_events_ts ON events (ts DESC);
      CREATE INDEX idx_events_level_source ON events (level, source);

      CREATE TABLE tmdb_cache (
        key TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE gateway_cache (
        key TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `,
  },
  {
    // SQLite cannot alter a CHECK constraint, so the events table is rebuilt to admit the 'prefetch' source.
    version: 2,
    sql: `
      CREATE TABLE events_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
        source TEXT NOT NULL CHECK (source IN ('gateway', 'tmdb', 'torbox', 'ffmpeg', 'session', 'health', 'server', 'prefetch')),
        message TEXT NOT NULL,
        details_json TEXT,
        session_id TEXT
      );
      INSERT INTO events_v2 (id, ts, level, source, message, details_json, session_id)
        SELECT id, ts, level, source, message, details_json, session_id FROM events;
      DROP TABLE events;
      ALTER TABLE events_v2 RENAME TO events;
      CREATE INDEX idx_events_ts ON events (ts DESC);
      CREATE INDEX idx_events_level_source ON events (level, source);
    `,
  },
];
