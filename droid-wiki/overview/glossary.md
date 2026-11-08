# Glossary

These terms connect shared contracts, the server pipeline, and client playback. Start with [architecture](architecture.md) for the runtime view.

| Term               | Meaning and source                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Capability profile | Codecs, HDR, dimensions, and audio limits reported by a device, `packages/shared/src/schemas.ts`                            |
| Decision           | Server-selected output codec, dimensions, audio, dynamic range, and burn-in, `apps/server/src/playback/decision.ts`         |
| Gateway            | Configured source-discovery service, `apps/server/src/gateway/client.ts`                                                    |
| Stream option      | Parsed source metadata without its raw URL, `packages/shared/src/streams.ts`                                                |
| Cast member        | Name, character, and optional profile image in bounded title details, `packages/shared/src/catalog.ts`                      |
| Similar titles     | Recommendations with a similar-title fallback, normalized into the details response, `apps/server/src/tmdb/normalize.ts`    |
| Automatic fallback | Trying ranked candidates after startup failure, `apps/server/src/playback/sessionStart.ts`                                  |
| Session            | Playback state with tracks, encoder, segments, and progress, `apps/server/src/playback/sessionRecord.ts`                    |
| Session slot       | Resource ownership that is not released while a stopped encoder still runs, `apps/server/src/playback/sessionSlots.ts`      |
| Source proxy       | Loopback HTTP service hiding expiring links and sharing ranged bytes, `apps/server/src/sourceproxy/proxy.ts`                |
| Prefetch           | Warming bytes and probe results without encoding, `apps/server/src/prefetch/service.ts`                                     |
| Download           | Tracking upstream TorBox caching, not storing the entire title locally, `apps/server/src/downloads/service.ts`              |
| Placeholder        | Gateway downloading clip that must not become a playback session, `apps/server/src/playback/placeholder.ts`                 |
| Media key          | Movie or episode identity joining history and progress, `apps/server/src/db/plays.ts`                                       |
| Continue watching  | Resume items and aired next episodes derived from saved progress, `apps/server/src/progress/service.ts`                     |
| HLS                | HTTP playlists and media segments, `apps/server/src/playback/playlist.ts`                                                   |
| WebVTT             | Text subtitles exposed through HLS, `apps/server/src/playback/vtt.ts`                                                       |
| Burn-in            | Subtitles rendered into encoded video, `apps/server/src/playback/ffmpegArgs.ts`                                             |
| Encoder lead       | Encoded time ahead of the player used to gate reads, `apps/server/src/network/readAhead.ts`                                 |
| Event bus          | Typed in-process fan-out backing SSE, `apps/server/src/events/bus.ts`                                                       |
| Device id          | Random local client identifier, not an account, `apps/web/src/device/identity.ts`                                           |
| Install id         | Random identity for optional server analytics, `apps/server/src/db/settings.ts`                                             |
| Content mark       | `hs:home-content`, which releases deferred startup work, `apps/web/src/lib/startup.ts`                                      |
| Route template     | Analytics-safe route such as `/movie/:id`, `apps/web/src/telemetry/routes.ts`                                               |
| Supervisor         | Desktop controller that starts or attaches to the server, `apps/desktop/src/supervisor.ts`                                  |
| Desktop bridge     | Typed preload interface between renderer and main process, `packages/shared/src/desktop.ts`, `apps/desktop/src/preload.cts` |
| Mini player        | Separate desktop renderer taking over an existing session, `apps/desktop/src/miniPlayer.ts`                                 |
| Spoiler protection | Per-browser preference hiding unfinished episode overviews and reducing still resolution, `apps/web/src/lib/spoilers.ts`    |
| Migration          | Numbered SQL change tracked by SQLite `user_version`, `apps/server/src/db/index.ts`                                         |

See [shared contracts](../packages/shared.md), [playback](../systems/playback/index.md), and [viewing progress](../features/viewing-progress.md).
