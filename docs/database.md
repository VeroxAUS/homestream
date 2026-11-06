# Database

HomeStream keeps its state in one SQLite file, `homestream.db` in `DATA_DIR`, opened with `node:sqlite` (no native npm dependency). The schema is created by the numbered migrations in [`apps/server/src/db/migrations.ts`](../apps/server/src/db/migrations.ts). The migration number is stored in `PRAGMA user_version`.

The complete, generated schema is [`schema.sql`](schema.sql). Regenerate it after changing a migration, and check it for drift:

```
pnpm db:schema          # writes docs/schema.sql
pnpm db:schema:check    # fails when schema.sql is stale or a table has no section below
```

Conventions: timestamps are epoch milliseconds (integers), booleans are `0`/`1` integers, JSON columns end in `_json` and hold text. No stream URL, CDN link or API key is ever stored. See the entity diagram in [architecture.md](architecture.md#data-model).

To add a column or table, append a new migration with the next version number (never edit an old one), run `pnpm db:schema`, then add or update the section here.

## Tables

### `progress`

One row per title (`media_key` such as `movie:278` or `tv:1396:1:1`) with the last known playback position. It drives resume and the continue watching row. `completed` is set at 92% of the duration, `hidden` removes the title from continue watching without deleting the position, and `meta_json` caches display data (title, artwork) so the row renders without a TMDB call.

### `plays`

One row per playback session, written when the session starts and updated while it runs. It holds the device, the chosen source (resolution, codec, HDR, audio), the decision JSON, watched seconds, average bitrate and encoder speed, bytes served and an `ok`/`error` status. History and statistics endpoints (`/api/history`, `/api/stats/summary`, `/api/stats/graphs`) read this table.

### `devices`

Client devices that registered with `POST /api/devices`: id, display name, kind (`tv`, `desktop`, `web`), the capability profile as JSON, last IP and last seen time. Devices are the only notion of "who" (there are no user accounts).

### `events`

The in-app event log shown on the health page and returned by `GET /api/logs`. Each row has a level (`info`, `warn`, `error`), a source (`gateway`, `tmdb`, `torbox`, `ffmpeg`, `session`, `health`, `server`, `prefetch`, `downloads`), a redacted message and optional details JSON and session id. Rows older than 30 days are pruned as new events are written.

### `tmdb_cache`

Cache of TMDB responses (`key` to `json`) with an expiry time. Lets the home screen and detail pages render without a TMDB round trip.

### `gateway_cache`

Cache of parsed gateway stream lists per title and device query, with an expiry time. It keeps the number of gateway requests low, which matters because the gateway allows only a few requests every few seconds.

### `pending_downloads`

The TorBox caching queue. Playing a title that has no cached stream asks TorBox to cache it and adds a row here. A poller updates `state`, `progress` and `eta_sec` until the download is `ready` or `failed`, then a "ready to watch" notification is sent once (`notified_at`). A partial unique index allows only one pending row per `media_key`. The playback link is never stored; it is looked up again with `query_key` when the title is played.
