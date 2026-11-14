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
  {
    // Admits the 'downloads' event source (same rebuild as version 2) and adds the TorBox caching queue.
    // No gateway/CDN URL is ever stored here: the playback link is re-resolved from query_key when needed.
    version: 3,
    sql: `
      CREATE TABLE events_v3 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
        source TEXT NOT NULL CHECK (source IN ('gateway', 'tmdb', 'torbox', 'ffmpeg', 'session', 'health', 'server', 'prefetch', 'downloads')),
        message TEXT NOT NULL,
        details_json TEXT,
        session_id TEXT
      );
      INSERT INTO events_v3 (id, ts, level, source, message, details_json, session_id)
        SELECT id, ts, level, source, message, details_json, session_id FROM events;
      DROP TABLE events;
      ALTER TABLE events_v3 RENAME TO events;
      CREATE INDEX idx_events_ts ON events (ts DESC);
      CREATE INDEX idx_events_level_source ON events (level, source);

      CREATE TABLE pending_downloads (
        id TEXT PRIMARY KEY,
        media_key TEXT NOT NULL,
        media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
        tmdb_id INTEGER NOT NULL,
        season INTEGER,
        episode INTEGER,
        query_key TEXT NOT NULL,
        title TEXT NOT NULL,
        info_hash TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
        state TEXT NOT NULL CHECK (state IN ('pending', 'downloading', 'ready', 'failed')),
        progress REAL NOT NULL DEFAULT 0,
        eta_sec INTEGER,
        reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        next_poll_at INTEGER NOT NULL,
        progress_changed_at INTEGER NOT NULL,
        last_event_at INTEGER,
        ready_since INTEGER,
        notified_at INTEGER
      );
      CREATE UNIQUE INDEX pending_downloads_active ON pending_downloads (media_key) WHERE status = 'pending';
      CREATE INDEX idx_pending_downloads_created ON pending_downloads (created_at DESC);
    `,
  },
  {
    // Small key/value store for server-owned state, for example the random install id used by product analytics.
    version: 4,
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    // When TorBox first stopped listing a pending download, and when it first reported it in metaDL (looking up the file
    // list). Both are cleared when the condition ends; the poller fails the download after 10 and 30 minutes.
    version: 5,
    sql: `
      ALTER TABLE pending_downloads ADD COLUMN absent_since INTEGER;
      ALTER TABLE pending_downloads ADD COLUMN metadata_since INTEGER;
    `,
  },
];
