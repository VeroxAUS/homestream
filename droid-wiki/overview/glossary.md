# Glossary

These terms connect the shared contracts, playback pipeline, and browser UI. Start with [architecture](architecture.md) for the runtime view.

| Term               | Meaning and source                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Capability profile | Device codecs, HDR, dimensions, and audio limits, `packages/shared/src/schemas.ts`                                           |
| Decision           | Server-selected codec, output dimensions, audio, dynamic range, and subtitle burn-in, `apps/server/src/playback/decision.ts` |
| Gateway            | Configured service for stream discovery, `apps/server/src/gateway/client.ts`                                                 |
| Stream option      | Parsed source metadata exposed without the raw source URL, `packages/shared/src/streams.ts`                                  |
| Automatic fallback | Trying ranked sources when a source fails startup, `apps/server/src/playback/manager.ts`                                     |
| Session            | Playback state with encoder, segment store, tracks, and progress, `apps/server/src/playback/session.ts`                      |
| Source proxy       | Loopback HTTP server that hides expiring links and shares byte-range caches, `apps/server/src/sourceproxy/proxy.ts`          |
| Prefetch           | Warming source bytes and probe results without encoding, `apps/server/src/prefetch/service.ts`                               |
| Download           | Tracking a TorBox caching job upstream, not storing a complete movie locally, `apps/server/src/downloads/service.ts`         |
| Media key          | Stable movie/episode identity joining progress, plays, and download tracking, `apps/server/src/db/plays.ts`                  |
| Continue watching  | Resume items and aired next episodes derived from progress, `apps/server/src/progress/service.ts`                            |
| HLS                | HTTP playlists and media segments, `apps/server/src/playback/playlist.ts`                                                    |
| WebVTT             | Text subtitles exposed as HLS renditions, `apps/server/src/playback/vtt.ts`                                                  |
| Burn-in            | Subtitles rendered into encoded video, `apps/server/src/playback/ffmpegArgs.ts`                                              |
| Encoder lead       | Encoded media time ahead of the player, used to gate source reads, `apps/server/src/network/readAhead.ts`                    |
| Event bus          | In-process typed fan-out used by SSE, `apps/server/src/events/bus.ts`                                                        |
| Device id          | Random browser identifier, independent of accounts or analytics, `apps/web/src/device/identity.ts`                           |
| Install id         | Random local identity for optional server analytics, `apps/server/src/db/settings.ts`                                        |
| Identity scrubber  | Removes machine and user-name words from reports, `packages/shared/src/identity.ts`                                          |
| Content mark       | `hs:home-content`, the performance mark that releases deferred browser work, `apps/web/src/lib/startup.ts`                   |
| Route template     | Analytics-safe path such as `/movie/:id`, without a title identifier, `apps/web/src/telemetry/routes.ts`                     |
| Migration          | Numbered SQL update tracked by SQLite `user_version`, `apps/server/src/db/index.ts`                                          |

See [shared contracts](../packages/shared.md) and [viewing progress](../features/viewing-progress.md) for the underlying types and rules.
