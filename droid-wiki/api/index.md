# HTTP API

Fastify exposes JSON APIs, HLS files, and server-sent events without authentication on the trusted LAN. Request contracts live in `packages/shared/src/`; see [security](../security.md) before exposing the listener.

## Route table

Routes are registered by `apps/server/src/app.ts` from `apps/server/src/routes/`.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/info` | Name, version, actual port, LAN addresses |
| GET | `/api/devices` | `{ devices }` |
| POST | `/api/devices` | Upsert capability profile and caller IP; returns device |
| GET | `/api/home` | Catalog rows; `continueWatching` currently empty |
| GET | `/api/search?q=...` | Nonempty query; `{ results }` |
| GET | `/api/movie/:tmdbId` | Movie details |
| GET | `/api/tv/:tmdbId` | Show details |
| GET | `/api/tv/:tmdbId/season/:n` | Season and episodes |
| GET | `/api/streams/movie/:tmdbId` | Stream list and recommendation |
| GET | `/api/streams/tv/:tmdbId/:season/:episode` | Episode stream list and recommendation |
| POST | `/api/prefetch` | Warm candidate; 202 `{ streamId }`, possibly null |
| POST | `/api/sessions` | Start playback; 201 session response |
| GET | `/api/activity` | `{ sessions }` activity snapshots |
| GET | `/api/sessions/:id` | Session response |
| PATCH | `/api/sessions/:id` | Audio/subtitle selection only |
| DELETE | `/api/sessions/:id` | Stop; `{ sessionId, state: "stopped" }` |
| GET | `/api/events` | SSE connection |
| GET | `/hls/:id/:file` | Master/video playlists, init, media segments |
| GET | `/hls/:id/subs/:file` | Completed full WebVTT, `<index>.vtt` |
| GET | `/hls/:id/subs/:idx/:file` | Subtitle `index.m3u8` or `seg-N.vtt` |

Stream routes accept optional `deviceId`. IDs must be positive integers except season numbers may be zero. Device bodies contain identity, kind, dimensions, codec/HDR booleans, and audio-channel limit (`packages/shared/src/schemas.ts`).

## Playback contracts

`packages/shared/src/playback.ts` defines session creation: `mediaType`, `tmdbId`, `streamId` (including `"auto"`), and `device`; TV also requires season/episode. Optional fields are `startPositionSec`, `audioIndex`, and `subtitle: { index, mode: "sidecar" | "burn" } | null`. Prefetch uses media identity and device, without a stream selection.

PATCH requires `audioIndex`, `subtitle`, or both; null clears subtitles and omission preserves them. There is no HTTP heartbeat, progress, pause, or seek endpoint. Seeking is driven by requested HLS segments. Responses include playlist URLs, decision, tracks, selection, encoder stats, state, and error.

`apps/server/src/playback/playlist.ts` accepts `index.m3u8`, `video.m3u8`, `init.mp4`, and `seg-N.ts`/`seg-N.m4s`. HLS responses use no-cache; subtitle extraction may require retries. Use returned URLs.

## Events, errors, and assets

`apps/server/src/routes/events.ts` writes `retry: 3000`, then frames `event: <type>\ndata: <JSON>\n\n`. An immediate heartbeat and 15-second heartbeats contain `{ ts }`. Bus names include `session.start`, `session.update`, `session.end`, `log`, and reserved `health`. There are no event IDs or durable replay/Last-Event-ID handling; reconnect and refetch snapshots.

Errors use `{ error: { code, message, hint? } }`; unexpected 500s hide details (`apps/server/src/errors.ts`). Built web assets are served conditionally with extensionless SPA fallback outside `/api` and `/hls`. The loopback `/src/<key>` proxy is internal, not a public API.

See [playback](../systems/playback/index.md) and [monitoring](../how-to-monitor.md).
