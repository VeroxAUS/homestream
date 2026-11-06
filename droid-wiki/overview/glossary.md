# Glossary

These terms connect HomeStream's API contracts, playback pipeline, and background services. Start with [architecture](architecture.md) for the runtime view.

| Term               | Meaning and source                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Capability profile | Device codecs, HDR support, output size, and audio limits, `packages/shared/src/schemas.ts`                                    |
| Decision           | Server-selected output codec, dimensions, dynamic range, audio, and burn-in plan, `apps/server/src/playback/decision.ts`       |
| Gateway            | Configured service that discovers and resolves source streams, `apps/server/src/gateway/client.ts`                             |
| Stream option      | Parsed candidate quality metadata without exposing its raw source URL, `packages/shared/src/streams.ts`                        |
| Automatic fallback | Trying ranked cached sources until one produces usable output, `apps/server/src/playback/manager.ts`                           |
| Session            | Managed playback state, encoder, files, tracks, and progress, `apps/server/src/playback/session.ts`                            |
| Source proxy       | Loopback HTTP layer that hides expiring URLs and shares cached byte ranges, `apps/server/src/sourceproxy/proxy.ts`             |
| Prefetch           | Speculative source/probe warming before playback, `apps/server/src/prefetch/service.ts`                                        |
| Download           | Persistent tracking of an upstream TorBox caching job, not a full local media download, `apps/server/src/downloads/service.ts` |
| Media key          | Stable movie or episode key shared by plays, progress, and downloads, `apps/server/src/db/plays.ts`                            |
| Continue watching  | Resume entries and aired next episodes derived from saved progress, `apps/server/src/progress/service.ts`                      |
| HLS                | Playlists and media segments served over HTTP, `apps/server/src/playback/playlist.ts`                                          |
| WebVTT             | Text subtitles extracted progressively and exposed as HLS renditions, `apps/server/src/playback/vtt.ts`                        |
| Burn-in            | Subtitles rendered into the encoded video instead of a separate text track, `apps/server/src/playback/ffmpegArgs.ts`           |
| Encoder lead       | Encoded media time ahead of the playhead, used to hold/resume upstream reads, `apps/server/src/network/readAhead.ts`           |
| Event bus          | In-process typed fan-out for SSE snapshots and changes, `apps/server/src/events/bus.ts`                                        |
| Migration          | Transactional SQL update tracked by SQLite `user_version`, `apps/server/src/db/index.ts`                                       |
| Install id         | Random local identifier used only when analytics is enabled, `apps/server/src/db/settings.ts`                                  |

See [shared contracts](../packages/shared.md) for the types used across clients and server.
