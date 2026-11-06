# API

Active contributors: VeroxAUS

HomeStream exposes JSON routes under `/api`, HLS under `/hls`, and local probes/metrics at the root. It has no login or API authentication; use it only on a trusted LAN ([security](../security.md)).

## Contract and discovery

`apps/server/src/app.ts` registers route modules. Requests are parsed in handlers with Zod schemas from `packages/shared/src/`; `apps/server/src/docs/routeDocs.ts` supplies documentation metadata. `apps/server/src/docs/openapi.ts` generates OpenAPI 3.0.3 and Swagger UI at `/api/docs`, with JSON at `/api/docs/json`. The committed export is `docs/openapi.json`.

OpenAPI schemas are documentation-only: they do not replace the handlers' runtime validation or install response serialization. When details differ, inspect the route and service. The API contract version is `1.0.0`, separate from app/release version; there is no `/v1` URL prefix.

Every response receives `X-Request-ID`. Safe caller IDs are preserved; invalid ones become UUIDs (`apps/server/src/requestContext.ts`, `apps/server/src/http/observability.ts`). JSON errors follow `ErrorResponseSchema` in `packages/shared/src/schemas.ts`: `{ error: { code, message, hint? } }`, with optional failed-start `attempts` both inside `error` and at the top level. Expected errors retain status/hints; unexpected failures become generic 500 responses (`apps/server/src/errors.ts`, `apps/server/src/app.ts`).

## Route groups

These are the explicitly registered application methods. Unless noted, success is 200 JSON. Full field constraints and status lists remain in shared schemas and `docs/openapi.json`.

| Group and implementation                         | Methods and paths                                                            | Contract/behavior                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Identity, `apps/server/src/routes/info.ts`       | GET `/api/info`                                                              | `ServerInfoSchema`: app/name/version/actual port/LAN addresses                                   |
| Devices, `apps/server/src/routes/devices.ts`     | GET, POST `/api/devices`                                                     | List `{ devices }`; POST upserts a `CapabilityProfileSchema` and returns `DeviceSchema`          |
| Catalog, `apps/server/src/routes/catalog.ts`     | GET `/api/home`, `/api/search`                                               | Home rows including continue watching; search uses `SearchQuerySchema` and returns `{ results }` |
| Catalog details                                  | GET `/api/movie/:tmdbId`, `/api/tv/:tmdbId`, `/api/tv/:tmdbId/season/:n`     | Movie/show details with optional tracked downloads; season episodes                              |
| Streams, `apps/server/src/routes/streams.ts`     | GET `/api/streams/movie/:tmdbId`, `/api/streams/tv/:tmdbId/:season/:episode` | Optional `deviceId`; ranked `StreamsResponseSchema`, no raw source URL                           |
| Sessions, `apps/server/src/routes/sessions.ts`   | POST `/api/sessions`                                                         | 201 `SessionResponseSchema` or 202 `DownloadStartedResponseSchema`                               |
| Live activity                                    | GET `/api/activity`                                                          | `{ sessions: ActivitySession[] }`                                                                |
| Session operations                               | GET, PATCH, DELETE `/api/sessions/:id`                                       | Snapshot; track change; stop response `{ sessionId, state: "stopped" }`                          |
| Progress, `apps/server/src/routes/progress.ts`   | POST `/api/sessions/:id/progress`, GET `/api/progress/:mediaKey`             | Ping and saved `ProgressResponseSchema`                                                          |
| Continue watching                                | GET `/api/continue-watching`, DELETE `/api/continue-watching/:mediaKey`      | `{ items }`; removal `{ mediaKey, removed }`                                                     |
| Downloads, `apps/server/src/routes/downloads.ts` | GET `/api/downloads`, DELETE `/api/downloads/:id`                            | `{ downloads }`; stop tracking `{ id, state: "cancelled" }`                                      |
| History, `apps/server/src/routes/history.ts`     | GET `/api/history`                                                           | Filtered, paginated `HistoryResponseSchema`                                                      |
| Statistics                                       | GET `/api/stats/summary`, `/api/stats/graphs`                                | `StatsQuerySchema`; aggregate summary and chart buckets                                          |
| Prefetch, `apps/server/src/routes/prefetch.ts`   | POST `/api/prefetch`                                                         | 202 `{ streamId: string \| null }`; warming continues in background                              |
| Health/logs, `apps/server/src/routes/health.ts`  | GET `/api/health`, POST `/api/health/run`, GET `/api/logs`                   | Health snapshot/manual refresh and persisted event query                                         |
| Events, `apps/server/src/routes/events.ts`       | GET `/api/events`                                                            | Open `text/event-stream`, described below                                                        |
| Operations, `apps/server/src/routes/ops.ts`      | GET `/healthz`, `/readyz`, `/metrics`                                        | Liveness JSON, readiness JSON, Prometheus text                                                   |
| HLS, `apps/server/src/routes/sessions.ts`        | GET `/hls/:id/:file`, `/hls/:id/subs/:file`, `/hls/:id/subs/:idx/:file`      | Playlists, encoded media, complete/segmented WebVTT                                              |

`parseId` in `apps/server/src/routes/params.ts` accepts safe whole-number TMDB IDs; seasons can be zero for specials, episodes start at one. Progress keys are `movie:<tmdbId>` or `tv:<tmdbId>:<season>:<episode>`, bounded to 64 characters on lookup.

History accepts `type`, `deviceId`, `q`, `from`, `to`, `page` and `pageSize` (default 1/20, maximum page size 100). Time bounds accept epoch milliseconds, ISO timestamps or local calendar days. Statistics use `days`, default 30, range 1–3650 (`packages/shared/src/progress.ts`, `apps/server/src/stats/timeBound.ts`).

Logs accept `level`, `source` and `limit` (default 100, maximum 1000). Manual health refresh recognizes `fresh=1` or `fresh=true` and can call upstreams/run local checks. `/healthz` and `/readyz` make no external calls; readiness writes/removes a small file and is limited to 300 requests per minute per caller address.

See [catalog](../features/catalog.md), [stream selection](../features/stream-selection.md), [downloads](../features/downloads.md), [viewing progress](../features/viewing-progress.md), and [health](../systems/health.md) for service semantics.

## Start, select tracks and report progress

`SessionStartRequestSchema` in `packages/shared/src/playback.ts` defines the actual request names:

| Field                 | Constraint                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `mediaType`, `tmdbId` | `"movie"` or `"tv"`; positive integer TMDB ID                                             |
| `season`, `episode`   | Required for TV; season ≥ 0, episode ≥ 1                                                  |
| `streamId`            | Nonempty bounded string; clients send `"auto"`                                            |
| `device`              | Full `CapabilityProfileSchema`, not just a device ID                                      |
| `startPositionSec`    | Optional, 0–86400 seconds                                                                 |
| `audioIndex`          | Optional nonnegative integer                                                              |
| `subtitle`            | Omitted for automatic defaults, `null` for Off, or `{ index, mode: "sidecar" \| "burn" }` |

`CapabilityProfileSchema` in `packages/shared/src/schemas.ts` requires `deviceId`, `deviceName`, `kind` (`tv`, `desktop`, `web`), `maxWidth`, `maxHeight`, `h264`, `hevc`, `hevcMain10`, `hdr10`, and `maxAudioChannels` (1–8). Device identity is not authentication.

A 201 response contains `sessionId`, **`playlistUrl`**, `mediaPlaylistUrl`, duration/start position, state, output `decision`, audio/subtitle tracks, selected tracks, `subtitleDefault`, successful `streamId`, earlier `{ streamId, code }` attempts, encoder stats and nullable error. `playlistUrl` is the master; `mediaPlaylistUrl` is the video playlist. There is no `hlsUrl` field.

A 202 response is `{ status: "downloading", download }`, defined in `packages/shared/src/downloads.ts`, not a session to play. Observe downloads and retry playback once ready. Prefetch uses the media identity and full device but no `streamId` (`PrefetchRequestSchema` in `packages/shared/src/playback.ts`).

PATCH accepts `audioIndex`, `subtitle`, or both, and at least one must be present. Omission preserves the current subtitle, `null` clears it; audio/burn-in changes can restart encoding. POST progress accepts `{ positionSec, state? }`, where state is `playing`, `paused` or `buffering`, defaulting to playing (`ProgressPingRequestSchema` in `packages/shared/src/progress.ts`). Progress reports are separate from track PATCH; seeking is driven by requested HLS segments. Send DELETE session requests without body or content-type.

See [playback](../systems/playback/index.md), [encoding](../systems/playback/encoding.md), [lifecycle](../systems/playback/lifecycle.md), and [prefetch](../features/prefetch.md).

## HLS and subtitles

`apps/server/src/playback/playlist.ts` generates a single video variant and optional text subtitle renditions, not an adaptive bitrate ladder. Full-duration VOD manifests use four-second segments and `EXT-X-ENDLIST` even before every file exists.

| Path suffix                     | Shape/content type                                   |
| ------------------------------- | ---------------------------------------------------- |
| `/hls/:id/index.m3u8`           | Master, `application/vnd.apple.mpegurl`              |
| `/hls/:id/video.m3u8`           | Video media playlist, same MIME                      |
| `/hls/:id/init.mp4`             | fMP4 init bytes, `video/mp4`                         |
| `/hls/:id/seg-N.m4s`            | HEVC fMP4 media, `video/mp4`                         |
| `/hls/:id/seg-N.ts`             | H.264 MPEG-TS media, `video/mp2t`                    |
| `/hls/:id/subs/:idx/index.m3u8` | Duration-derived WebVTT rendition playlist, HLS MIME |
| `/hls/:id/subs/:idx/seg-N.vtt`  | WebVTT segment, `text/vtt; charset=utf-8`            |
| `/hls/:id/subs/:idx.vtt`        | Complete extracted WebVTT file                       |

Use returned track URLs. Text tracks have `url` from creation and `fullUrl` when complete, with `extracting`, `complete` or `error` status; bitmap tracks have no sidecar URL (`SubtitleTrackSchema` in `packages/shared/src/playback.ts`).

Media serving waits for missing segments and can seek/restart encoding. Successful HLS responses use `Cache-Control: no-cache`. A subtitle range not extracted yet waits up to six seconds, then returns **503 `subtitle_not_ready`**, `Retry-After: 1` and `Cache-Control: no-store`; it does not send an empty 200 to hide missing data. A complete-file request before completion returns 404 `subtitle_not_ready` (`apps/server/src/playback/manager.ts`). The generic OpenAPI HLS response metadata is less specific than these runtime MIME/retry behaviors.

Filename parsers permit only the named playlists/init and bounded numeric segment/track forms. Clients cannot choose arbitrary session-directory files. See [subtitles](../systems/playback/subtitles.md) and [source proxy](../systems/source-proxy.md); the loopback `/src/<key>` route is internal, not another public media API.

## SSE frames and recovery

`apps/server/src/routes/events.ts` starts with `retry: 3000`, sends an immediate `heartbeat` with `{ ts: <epoch milliseconds> }`, then another every 15 seconds. Each application frame is exactly:

```text
event: <event-name>
data: <JSON payload>

```

There is no `id:` field or Last-Event-ID replay cursor. Headers include no-cache/no-transform, keep-alive and `X-Accel-Buffering: no`. The wire payload is `event.data`, not the internal `{ type, data, ts }` bus wrapper (`apps/server/src/events/bus.ts`).

| Event                                | Actual payload/source                                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.start`, `session.update`    | Activity snapshot shaped by `ActivitySessionSchema` in `packages/shared/src/playback.ts`; emitted from `apps/server/src/playback/manager.ts` |
| `session.end`                        | `{ sessionId, reason, state: "stopped" }`, from the manager                                                                                  |
| `health`                             | `HealthResponseSchema` in `packages/shared/src/health.ts`, from `apps/server/src/health/service.ts`                                          |
| `log`                                | Persisted row `{ id, ts, level, source, message, details, sessionId }`; the last two may be null (`apps/server/src/events/record.ts`)        |
| `download.started`, `download.ready` | `DownloadEventSchema` in `packages/shared/src/downloads.ts`                                                                                  |
| `download.progress`                  | `DownloadProgressEventSchema`: title/identity plus fraction/state and optional ETA                                                           |
| `download.failed`                    | `DownloadFailedEventSchema`: title/identity plus failure reason/message                                                                      |

The REST log projection omits absent optional fields, while the direct SSE row can contain nulls (`apps/server/src/events/query.ts`). Download schemas use `downloadId` in events versus `id` in list rows.

On reconnect, refetch activity/health/download snapshots. Download-ready notifications completed with no connected client have a specific persisted replay path, not general SSE history replay (`apps/server/src/downloads/service.ts`). Connections unsubscribe and clear timers on close; server pre-close ends open streams. See [logging](../how-to-monitor/logging.md).

## Extending the API

Follow `.factory/skills/homestream-add-api-route/SKILL.md`: shared schema, thin route, service behavior, route-doc entry, tests, regenerated export. `apps/server/test/integration/openapi.test.ts` guards undocumented routes and drift. Built static assets and extensionless SPA fallback are separate infrastructure (`apps/server/src/routes/static.ts`).

## Key source files

| File                                   | Purpose                                       |
| -------------------------------------- | --------------------------------------------- |
| `apps/server/src/app.ts`               | Route composition, CORS and error handling    |
| `apps/server/src/docs/routeDocs.ts`    | Route/schema/status documentation registry    |
| `apps/server/src/docs/openapi.ts`      | Swagger generation and explorer               |
| `packages/shared/src/playback.ts`      | Start, PATCH, session and activity schemas    |
| `packages/shared/src/progress.ts`      | Pings, resume/history/statistics schemas      |
| `packages/shared/src/downloads.ts`     | Download states, 202 response and SSE schemas |
| `apps/server/src/routes/events.ts`     | SSE wire protocol/lifetime                    |
| `apps/server/src/playback/playlist.ts` | HLS generation and filename constraints       |
