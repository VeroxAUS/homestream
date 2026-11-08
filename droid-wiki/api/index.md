# API

HomeStream exposes JSON under `/api`, playback under `/hls`, and root-level operational probes. There is no authentication or `/v1` prefix: callers must be on a trusted LAN. See [security](../security.md).

## Contract and discovery

`registerOpenApi` in `apps/server/src/docs/openapi.ts` exposes Swagger UI at `/api/docs` and JSON at `/api/docs/json`. `apps/server/src/docs/routeDocs.ts` combines route metadata with schemas from `packages/shared/src/`; the committed `docs/openapi.json` describes **33 path templates and 36 methods**, with API info version **1.0.0**, independent of release version.

These are the **36 documented method/path operations** at `0a8f04f` on **2026-11-08**, excluding automatic HEAD handling, CORS preflights, Swagger assets and static UI routes. `apps/server/src/docs/openapi.ts` attaches documentation-only schemas, not runtime validators or response serializers; most handlers explicitly parse shared Zod schemas.

Use `docs/openapi.json` for generated fields, bounds and documented statuses, but check handlers/services for runtime edge cases. For example, the subtitle segment operation documents 404/504 while `apps/server/src/playback/subtitleHandoff.ts` actually returns retryable **503** for extraction still pending. Generation consistency is not proof that every service error is enumerated.

`resolveRequestId` in `apps/server/src/requestContext.ts` preserves caller `X-Request-ID` values of 1–64 letters, digits, dots, underscores or hyphens; otherwise it generates a UUID. Responses echo the ID. `AppError` in `apps/server/src/errors.ts` produces `{ error: { code, message, hint? } }`; failed starts can also include attempt details. Unexpected failures return generic 500 errors. See [tracing](../how-to-monitor/tracing.md).

## Route map

Paths below use Fastify's `:parameter` notation; OpenAPI uses braces.

| Implementation                        | Methods and paths                                                                            | Purpose                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `apps/server/src/routes/info.ts`      | GET `/api/info`                                                                              | Version, actual port and LAN discovery addresses    |
| `apps/server/src/routes/devices.ts`   | GET, POST `/api/devices`                                                                     | List/upsert identity and capability profiles        |
| `apps/server/src/routes/catalog.ts`   | GET `/api/home`, `/api/search`                                                               | Home rows and search results                        |
| `apps/server/src/routes/catalog.ts`   | GET `/api/movie/:tmdbId`, `/api/tv/:tmdbId`, `/api/tv/:tmdbId/season/:n`                     | Movie/show/episode metadata                         |
| `apps/server/src/routes/streams.ts`   | GET `/api/streams/movie/:tmdbId`, `/api/streams/tv/:tmdbId/:season/:episode`                 | Ranked public options, without raw source URLs      |
| `apps/server/src/routes/sessions.ts`  | POST `/api/sessions`; GET `/api/activity`                                                    | Start and live activity                             |
| `apps/server/src/routes/sessions.ts`  | GET, PATCH, DELETE `/api/sessions/:id`                                                       | Snapshot, track change and stop                     |
| `apps/server/src/routes/progress.ts`  | POST `/api/sessions/:id/progress`; GET `/api/progress/:mediaKey`, `/api/tv/:tmdbId/progress` | Keepalive/progress and saved positions              |
| `apps/server/src/routes/progress.ts`  | GET `/api/continue-watching`; DELETE `/api/continue-watching/:mediaKey`                      | Resume list and removal                             |
| `apps/server/src/routes/downloads.ts` | GET `/api/downloads`; DELETE `/api/downloads/:id`                                            | Track cached downloads and cancel tracking          |
| `apps/server/src/routes/history.ts`   | GET `/api/history`, `/api/stats/summary`, `/api/stats/graphs`                                | Paginated history and aggregate statistics          |
| `apps/server/src/routes/prefetch.ts`  | POST `/api/prefetch`                                                                         | 202 acknowledgement of background warm-up           |
| `apps/server/src/routes/health.ts`    | GET `/api/health`, `/api/logs`; POST `/api/health/run`                                       | Health snapshot/manual run and durable events       |
| `apps/server/src/routes/events.ts`    | GET `/api/events`                                                                            | Server-sent events                                  |
| `apps/server/src/routes/ops.ts`       | GET `/healthz`, `/readyz`, `/metrics`                                                        | Cheap liveness, local readiness and Prometheus text |
| `apps/server/src/routes/sessions.ts`  | GET `/hls/:id/:file`, `/hls/:id/subs/:file`, `/hls/:id/subs/:idx/:file`                      | Playlists, segments and subtitles                   |

`parseId` in `apps/server/src/routes/params.ts` accepts bounded safe integer identifiers. TV seasons can include zero (specials); episodes start at one. Media keys are `movie:<tmdbId>` or `tv:<tmdbId>:<season>:<episode>`.

Unless noted, successful JSON reads, device upserts, track patches, progress pings and deletes return **200**, with a JSON body rather than 204. Playback creation uses **201/202**, prefetch always **202**, and failed readiness uses **503** (`apps/server/src/routes/sessions.ts`, `apps/server/src/routes/prefetch.ts`, `apps/server/src/routes/ops.ts`).

## Query and catalog behavior

| Route/query                 | Runtime behavior                                                                                                      | Contract/source                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `/api/search?q=...`         | Required trimmed nonempty string, maximum 200 characters; returns `{results}` without API pagination                  | `packages/shared/src/catalog.ts`, `apps/server/src/routes/catalog.ts`     |
| Stream `deviceId`           | Optional trimmed 1–128 characters; unknown/absent devices use ranking without a stored device cap                     | `packages/shared/src/streams.ts`, `apps/server/src/streams/service.ts`    |
| `/api/history`              | `page=1`, `pageSize=20`; size 1–100, page 1–1,000,000. Optional type, deviceId, q, from, to; blanks act as omitted    | `packages/shared/src/progress.ts`                                         |
| History `from`/`to`         | Epoch milliseconds, ISO timestamp or local `YYYY-MM-DD`; a day-valued `to` includes that day                          | `apps/server/src/routes/history.ts`, `apps/server/src/stats/timeBound.ts` |
| Statistics `days`           | Defaults to 30, integer 1–3650, local calendar-day buckets                                                            | `packages/shared/src/progress.ts`, `apps/server/src/stats/aggregate.ts`   |
| `/api/logs`                 | Optional exact level/source; `limit=100`, integer 1–1000; selected durable events, not process-file contents          | `packages/shared/src/health.ts`, `apps/server/src/routes/health.ts`       |
| `/api/health/run?fresh=...` | Only literal `1` or `true` enables fresh; other values currently behave as false, despite the narrower generated enum | `apps/server/src/routes/health.ts`                                        |

Movie/show details include `cast` (up to **15**) and `similar` (up to **20**) arrays. Shared parsers default absent arrays to `[]` for older-server payloads, while the current server supplies them. `apps/server/src/tmdb/service.ts` uses `movie:v2:<id>` / `tv:v2:<id>` cache keys and appends credits or aggregate credits, recommendations and similar metadata. See [catalog](../features/catalog.md) for normalization.

Settings/About does not introduce a settings HTTP endpoint. Device-name saving uses the device upsert; spoiler choice stays in browser storage and desktop preferences use IPC (`apps/web/src/device/identity.ts`, `apps/web/src/lib/spoilers.ts`, `apps/desktop/src/ipc.ts`). See [Settings and spoilers](../apps/web/settings-and-spoilers.md), [viewing progress](../features/viewing-progress.md) and [downloads](../features/downloads.md).

## Playback protocol

`SessionStartRequestSchema` in `packages/shared/src/playback.ts` requires `mediaType`, `tmdbId`, `streamId` and the full `device` capability profile. TV also requires season and episode. Clients always send `streamId: "auto"`. Optional fields include `startPositionSec`, `audioIndex` and `subtitle`: omission selects defaults, `null` means Off, and `{ index, mode: "sidecar" | "burn" }` selects a track.

- **201** returns `SessionResponseSchema`: `sessionId`, **`playlistUrl`**, `mediaPlaylistUrl`, decision, timing/state, audio/subtitle tracks, selection, successful stream ID, earlier attempts, stats and nullable error. There is no `hlsUrl`.
- **202** returns `{ status: "downloading", download }`, not a playable session. Track completion and retry when ready.
- **PATCH** accepts audio and/or subtitle changes; at least one is required. Omitted subtitle preserves selection; `null` clears it. Some changes restart encoding.
- **POST progress** accepts `{ positionSec, state? }`, with `playing`, `paused` or `buffering`; playing is the default (`ProgressPingRequestSchema` in `packages/shared/src/progress.ts`). Paused clients keep pinging to preserve the session.
- **DELETE** stops the session; send no body or content-type. Seeking is driven by requested HLS segments, not a separate seek endpoint.

`PrefetchRequestSchema` uses media identity and full device, without a manually selected stream. Its 202 body is `{streamId: string | null}`, not a session or a promise that a warm source is ready. Device IDs identify capabilities; they do not authenticate the caller. See [web player](../apps/web/player.md) and [playback lifecycle](../systems/playback/lifecycle.md).

## HLS and subtitles

`generateMasterPlaylist` and filename parsers in `apps/server/src/playback/playlist.ts` produce one video variant, not an adaptive ladder. Full-duration VOD manifests use four-second segments and `EXT-X-ENDLIST` before every file necessarily exists.

| Returned path shape                                             | Content                        |
| --------------------------------------------------------------- | ------------------------------ |
| `/hls/:id/index.m3u8`, `/hls/:id/video.m3u8`                    | Master and video playlists     |
| `/hls/:id/init.mp4`, `/hls/:id/seg-N.m4s`                       | HEVC fMP4 initialization/media |
| `/hls/:id/seg-N.ts`                                             | H.264 MPEG-TS media            |
| `/hls/:id/subs/:idx/index.m3u8`, `/hls/:id/subs/:idx/seg-N.vtt` | Segmented WebVTT rendition     |
| `/hls/:id/subs/:idx.vtt`                                        | Complete extracted WebVTT      |

`HlsServing` in `apps/server/src/playback/hlsServing.ts` waits for missing media and coordinates seek/recovery. Strict parsed filenames and session lookup prevent arbitrary session-directory file selection.

`SubtitleHandoff` in `apps/server/src/playback/subtitleHandoff.ts` waits for uncovered subtitle ranges; pending segments can return 503 `subtitle_not_ready` with `Retry-After: 1` and `Cache-Control: no-store`. An extractor already in error instead returns an empty WebVTT segment with `X-Subtitle-Status: failed`. A full-file request before completion returns 404 `subtitle_not_ready`. Use returned track URLs and readiness fields; bitmap tracks cannot become text sidecars. See [subtitles](../systems/playback/subtitles.md).

## Events and operations

`registerEventRoutes` in `apps/server/src/routes/events.ts` sends `retry: 3000`, an immediate `heartbeat`, then heartbeats every **15 seconds**. Frames contain `event: <name>` and `data: <JSON payload>`, without an event ID/replay cursor.

Events include `health`, `log`, `session.start`, `session.update`, `session.end`, and download started/progress/ready/failed. The payload is bus `event.data`, not its internal wrapper (`apps/server/src/events/bus.ts`). Reconnects need REST snapshot reconciliation. Connecting does **not** send a health baseline; the [web data layer](../apps/web/data-and-startup.md) reconciles through its health query and cancels older answers. Unnotified completed downloads have a specific durable replay path, not general SSE history.

`/healthz` returns 200 `{status:"ok"}` while HTTP answers. `/readyz` returns 200 `{status:"ready"}` after SQLite `SELECT 1` and a write/remove probe in `DATA_DIR`, or 503 `not_ready`; it is limited to **300 requests/minute/address**, then 429. `/metrics` reads counters and process state without upstream calls. Full health is more expensive: `fresh=1` or `fresh=true` on the manual route bypasses caches and may encode. See [health](../systems/health.md).

`/api/info` reports the actual listening port and ranked non-internal IPv4 addresses. Virtual/link-local candidates are excluded only if physical candidates remain; otherwise it falls back to all candidates. mDNS uses that same address list, not an inbound-access filter (`apps/server/src/routes/info.ts`, `apps/server/src/net.ts`, `apps/server/src/discovery.ts`).

## Change entry points

Follow `.factory/skills/homestream-add-api-route/SKILL.md`: shared schema, thin handler, service tests and route-doc entry, then `pnpm openapi:export`. `pnpm openapi:check` detects drift; `apps/server/test/integration/openapi.test.ts` checks route documentation. Generation uses a throwaway app, not live upstreams.

`registerStatic` in `apps/server/src/routes/static.ts` serves built web assets separately. SPA fallback excludes API/HLS and missing filename assets; see [deployment](../deployment.md).
