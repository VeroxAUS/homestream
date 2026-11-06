# Data models

HomeStream stores durable state in SQLite through Node's built-in `node:sqlite`, not a separate database service. Shared Zod contracts describe public JSON independently; see [shared contracts](../packages/shared.md).

## Database and migrations

`apps/server/src/db/index.ts` opens `homestream.db` under `DATA_DIR` (or an in-memory database when passed `:memory:`). It enables WAL, a 5000 ms busy timeout, and foreign keys. Current table definitions do not declare foreign-key relationships.

Migrations sort numerically and run each unapplied version in a transaction, updating `PRAGMA user_version` on success and rolling back on failure. `apps/server/src/db/migrations.ts` contains:

- Version 1: all six application tables and initial indexes.
- Version 2: rebuild `events`, copy existing rows/IDs, and recreate indexes to admit the `prefetch` source.

## Tables and indexes

| Table | Key and stored content | Explicit indexes |
| --- | --- | --- |
| `progress` | `media_key` primary key; TMDB/type/episode identity, position/duration, updated timestamp, completed/hidden flags, metadata JSON | `idx_progress_updated` (`updated_at DESC`), `idx_progress_tmdb` (`tmdb_id`) |
| `plays` | Autoincrement ID; unique `session_id`; media/device/client identity, start/end, watched/position/duration, source metadata, decision JSON, averages, bytes, status/error | `idx_plays_started` (`started_at DESC`), `idx_plays_media` (`media_key`), `idx_plays_device` (`device_id`) |
| `devices` | Text `id` primary key; name, kind, capabilities JSON, last IP/seen | None beyond primary-key enforcement |
| `events` | Autoincrement ID; timestamp, level/source, message, details JSON, optional session ID | `idx_events_ts` (`ts DESC`), `idx_events_level_source` (`level, source`) |
| `tmdb_cache` | Text `key` primary key; JSON and expiry timestamp | None beyond primary-key enforcement |
| `gateway_cache` | Text `key` primary key; JSON and expiry timestamp | None beyond primary-key enforcement |

Checks constrain movie/TV types, device kinds, play status (`ok`/`error`), and event levels/sources. Integer timestamps use epoch milliseconds; device API serialization converts `last_seen` to ISO text (`apps/server/src/db/devices.ts`).

## Writers and retention

`apps/server/src/db/plays.ts` uses `movie:<tmdbId>` or `tv:<tmdbId>:<season>:<episode>` media keys, inserts play starts, updates decisions on track changes, and finalizes end/status/averages. Schema columns do not imply every field already has a public writer: progress/history routes are absent and `/api/home` currently returns empty continue-watching.

TMDB cache TTLs are one hour for lists, 24 hours for details/config, and ten minutes for searches (`apps/server/src/tmdb/cache.ts`). Gateway results last one hour, empty results five minutes; expired rows remain available for stream-ID lookup until purged seven days past expiry (`apps/server/src/gateway/cache.ts`).

Events are redacted and periodically pruned to 30 days/10,000 rows (`apps/server/src/events/record.ts`). Devices, client IPs, play history, and cached upstream URLs remain sensitive local data; see [security](../security.md).
