# Glossary

These terms appear in HomeStream's server and shared contracts.

| Term | Meaning and source |
| --- | --- |
| Capability profile | Device codec, HDR, size, and audio limits, `packages/shared/src/schemas.ts` |
| Decision | Output codec, dimensions, dynamic range, and audio plan, `apps/server/src/playback/decision.ts` |
| Gateway | Configured upstream used to discover media streams, `apps/server/src/gateway/client.ts` |
| Stream option | Parsed candidate source with quality metadata, `packages/shared/src/streams.ts` |
| Session | Managed playback lifecycle and encoded output, `apps/server/src/playback/session.ts` |
| Source proxy | Internal loopback HTTP layer that resolves and caches upstream bytes, `apps/server/src/sourceproxy/proxy.ts` |
| Prefetch | Speculative warming before a playback session, `apps/server/src/prefetch/service.ts` |
| HLS | HTTP Live Streaming playlists and media segments, `apps/server/src/playback/playlist.ts` |
| WebVTT | Text subtitle representation produced and segmented by the playback pipeline, `apps/server/src/playback/vtt.ts` |
| Burn-in | Rendering subtitles into video instead of a separate text rendition, `apps/server/src/playback/ffmpegArgs.ts` |
| Event bus | Typed in-process fan-out used by server-sent events, `apps/server/src/events/bus.ts` |
| Migration | Versioned SQL update tracked through SQLite `user_version`, `apps/server/src/db/index.ts` |

Continue with [architecture](architecture.md) or [shared contracts](../packages/shared.md).
