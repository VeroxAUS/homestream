# Data models

Durable application state lives in one SQLite database; active sessions, probes, metrics and source-cache bytes live elsewhere. Public JSON uses shared Zod contracts rather than database row shapes (`apps/server/src/db/index.ts`, `packages/shared/src/index.ts`). See [shared](../packages/shared.md) and [viewing progress](../features/viewing-progress.md).

## Database lifecycle and migrations

`openDatabase` in `apps/server/src/db/index.ts` creates the data directory and opens the database in `DATA_DIR`, or an in-memory connection for the sentinel `:memory:`. It enables **WAL**, **5000 ms busy timeout** and `foreign_keys=ON`. The implementation uses Node's synchronous `node:sqlite` API, with no native SQLite npm package.

Migrations in `apps/server/src/db/migrations.ts` sort by numeric version. Each version above `PRAGMA user_version` runs in its own transaction; SQL and the version update commit together or roll back together.

| Version | Change                                                                                        |
| ------- | --------------------------------------------------------------------------------------------- |
| 1       | Creates `progress`, `plays`, `devices`, `events`, `tmdb_cache`, `gateway_cache` and indexes   |
| 2       | Rebuilds `events` to admit source `prefetch`, preserving IDs/rows and recreating indexes      |
| 3       | Rebuilds `events` to admit `downloads`; adds `pending_downloads` and its partial unique index |
| 4       | Adds `settings` for server-owned key/value state                                              |

There are **8 application tables** after version 4; SQLite's own autoincrement bookkeeping is not an application table. Foreign-key mode is on, but these migrations declare **no foreign keys**. Relations below are logical lookups, not enforced joins or cascades.

## Tables and writers

| Table               | Identity and content                                                                                                                                          | Writer/query entry points                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `progress`          | `media_key` primary key; TMDB/type/season/episode, position/duration, updated time, completed/hidden flags and display metadata JSON                          | `apps/server/src/db/progress.ts`, `apps/server/src/progress/service.ts`      |
| `plays`             | Autoincrement ID, unique `session_id`; media/device/client snapshot, timing, watched position, source description, decision JSON, averages/bytes/status/error | `apps/server/src/db/plays.ts`, `apps/server/src/db/history.ts`               |
| `devices`           | Client `id` primary key; display name/kind, capability JSON, last IP and last seen                                                                            | `apps/server/src/db/devices.ts`                                              |
| `events`            | Autoincrement ID, epoch timestamp, level/source/message, optional details JSON and session ID                                                                 | `apps/server/src/events/record.ts`, `apps/server/src/events/query.ts`        |
| `tmdb_cache`        | Cache key, response JSON and expiry                                                                                                                           | `apps/server/src/tmdb/cache.ts`                                              |
| `gateway_cache`     | Query key, parsed server-side stream-list JSON and expiry                                                                                                     | `apps/server/src/gateway/cache.ts`                                           |
| `pending_downloads` | UUID key; title/media/query/info-hash identity, lifecycle/status, progress/ETA, polling/event/readiness/notification times                                    | `apps/server/src/downloads/store.ts`, `apps/server/src/downloads/service.ts` |
| `settings`          | Text key/value and update time; currently analytics `install_id`                                                                                              | `apps/server/src/db/settings.ts`                                             |

Timestamps in storage are epoch milliseconds; flags are integer 0/1. JSON is text, including the `capabilities` and cache `json` columns that do not carry the `_json` suffix. Device API `lastSeen` is ISO text (`apps/server/src/db/devices.ts`).

Important indexes include descending progress update time/TMDB ID, play start time/media/device, and event timestamp/level-source. `pending_downloads_active` permits only one `status='pending'` row per media key; completed/failed historical rows can coexist (`apps/server/src/db/migrations.ts`).

## Logical identities and transitions

`mediaKeyFor` in `apps/server/src/db/plays.ts` produces `movie:<tmdbId>` or `tv:<tmdbId>:<season>:<episode>`. This key links progress, plays and downloads by convention. Gateway `query_key` instead uses IMDb identity and optional episode numbers (`apps/server/src/gateway/types.ts`). A download can re-resolve its link from that key without storing a playback URL in the download row.

`plays.device_id` refers logically to a registered device, but play rows also snapshot name/kind/IP so history is not dependent on a device join. `events.session_id` correlates local diagnostics; there is no persisted `sessions` table.

Progress pings upsert position/display metadata and clear hidden state. Completion is **92%** of duration; incomplete position at least **60 s** is resumable (`packages/shared/src/progress.ts`, `apps/server/src/progress/rules.ts`). Removing continue-watching hides progress, or adds an episode hidden marker, without deleting plays. New pings can bring it back. Play completion stays set once a session ping reaches completion, and finalization only updates a row whose end is still null (`apps/server/src/db/plays.ts`).

Downloads have coarse `status` (`pending`, `ready`, `failed`) and more detailed `state` (`pending`, `downloading`, `ready`, `failed`). `ready_since` may be set while waiting for the gateway's cached stream to appear; `notified_at` records one-time delivery bookkeeping. See [downloads](../features/downloads.md).

## Retention and cache expiry

| Data                               | Expiry/cleanup behavior                                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TMDB response cache                | Lists **1h**; details/config/recommendations **24h**; search **10m**. Expired or invalid JSON rows are deleted on `get`                                   |
| Gateway stream cache               | Nonempty list **1h**, empty list **5m**. Expired rows remain readable for stream-ID lookup; `purgeExpired()` removes rows at least **7 days past expiry** |
| Events                             | Every **200 event writes**, prune older than **30 days** and beyond newest **10,000**                                                                     |
| Finished downloads                 | Nonpending rows older than **30 days by updated time** are pruned when the service starts                                                                 |
| Progress, plays, devices, settings | No TTL/periodic purge implemented in their storage modules                                                                                                |

Sources: `apps/server/src/tmdb/cache.ts`, `apps/server/src/gateway/cache.ts`, `apps/server/src/events/record.ts`, `apps/server/src/downloads/store.ts`, `apps/server/src/downloads/service.ts`. The cache modules expose bulk purge methods, but no runtime caller currently schedules them. A freshness TTL is therefore not a promise that the database physically forgets a row at that time.

Active session/HLS lifecycle cleanup and source-cache eviction are separate from SQLite history retention; see [playback lifecycle](../systems/playback/lifecycle.md) and [source proxy](../systems/source-proxy.md).

## Sensitive local data and public contracts

Local state includes device names/IPs, watch history, media/source filenames, artwork links, info hashes and cached server-side gateway URLs. In particular, `GatewayCache.set` serializes `GatewayStream[]`, whose type includes `url` (`apps/server/src/gateway/cache.ts`, `apps/server/src/gateway/types.ts`). Do **not** infer that no stream URL is persisted from the maintained database document's broad statement; the no-playback-link guarantee applies to download rows, not the entire cache database.

Events are redacted on write/read, but other local tables are not telemetry payloads and are not generally anonymized. The install ID is a random persisted UUID, created when PostHog initializes, not a hardware or account ID (`apps/server/src/db/settings.ts`, `apps/server/src/telemetry/index.ts`). Restrict database/backups locally; see [security](../security.md) and [telemetry](../systems/telemetry.md).

Shared schemas define camelCase API models for capabilities, catalog, stream options, sessions/decisions, downloads, progress/history/stats, health/logs and probes. They do not turn SQL rows into automatically validated responses or automatically enforce a foreign-key relationship.

## Modification entry points

Append a new migration; never change a published one. Update row adapters, shared schemas and consumers as needed. Regenerate `docs/schema.sql` with `pnpm db:schema`, document the table in `docs/database.md`, and validate with `pnpm db:schema:check`. Use `docs/schema.sql` for exhaustive columns/indexes rather than copying a stale schema into this page.

## Key source files

| File                                 | Purpose                                       |
| ------------------------------------ | --------------------------------------------- |
| `apps/server/src/db/index.ts`        | Connection pragmas and transactional migrator |
| `apps/server/src/db/migrations.ts`   | Complete versioned DDL                        |
| `apps/server/src/db/progress.ts`     | Upsert/hide semantics and eligible progress   |
| `apps/server/src/db/plays.ts`        | Media keys and play lifecycle                 |
| `apps/server/src/db/history.ts`      | History query and row serialization           |
| `apps/server/src/db/settings.ts`     | Server state and random install ID            |
| `apps/server/src/downloads/store.ts` | Queue state and startup pruning               |
| `apps/server/src/gateway/types.ts`   | Server-only URL-bearing stream shape          |
| `packages/shared/src/progress.ts`    | Public progress/history/stats contracts       |
| `docs/schema.sql`                    | Generated complete SQLite schema              |
| `docs/database.md`                   | Maintained table descriptions                 |
