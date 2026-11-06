# Playback

Active contributors: VeroxAUS (origin/main sole human)

Playback turns a selected source into device-specific, seekable HLS. It always builds an encoded output; it is not a direct-play/remux selection engine or adaptive-bitrate ladder.

## Layout

- `apps/server/src/playback/manager.ts`: session creation, HLS serving, seeks, track changes, process recovery, and teardown.
- `apps/server/src/playback/decision.ts`, `apps/server/src/playback/ffmpegArgs.ts`, `apps/server/src/playback/probe.ts`: source inspection and [encoding](encoding.md).
- `apps/server/src/playback/subtitleExtractor.ts`, `apps/server/src/playback/subtitleRun.ts`, `apps/server/src/playback/subtitleStore.ts`: [progressive subtitles](subtitles.md).
- `apps/server/src/playback/monitor.ts`, `apps/server/src/playback/diskCap.ts`, `apps/server/src/playback/pidRegistry.ts`: [lifecycle and resource control](lifecycle.md).

## Key abstractions

| Abstraction | Meaning |
| --- | --- |
| `SessionRecord` | Per-session metadata, capability profile, source handle, probe, decision, output directory, state, process generation, and playhead |
| `Decision` | Selected video codec/size/range, AAC channel count, and source summary |
| `EncoderProcess` | One video FFmpeg child with progress parsing and bounded stderr tail |
| `SegmentStore` | Index and sizes of finished `.ts`/`.m4s` files |
| `SubtitleExtractor` | Independent multi-run subtitle controller and session-owned cue store |
| `SourceHandle` | Ownership of shared upstream/probe/cache plus main/extractor loopback URLs |

## Start-to-serve flow

1. Reserve a slot before asynchronous preparation. The default limit is **4** live/preparing sessions; failed sessions no longer consume a live slot.
2. Fetch TMDB details and upsert the device. Resolve `streamId`, or ask stream selection for the recommendation when it is `auto`. Missing IMDb metadata prevents auto discovery; a missing cached stream ID requires reloading the stream list.
3. Acquire the [source proxy](../source-proxy.md) entry by raw stream URL and session UUID. A prior prefetch can supply the already-resolved source, warmed bytes, and shared successful probe.
4. Probe through loopback; validate audio/subtitle choices; derive the output decision. Round the requested start down to a 4-second segment, capped at the final segment.
5. Create the session directory and play-history row. Register the session, start housekeeping, launch video FFmpeg and text extractors together, then publish `session.start`.
6. Return a session response while the encoder is still `starting`. The first finished segment of the current run changes that state to `ready`; progress pings can later report `playing` or `paused`.

The response exposes master `index.m3u8`, media `video.m3u8`, track metadata, decision, progress, and errors. It retains the requested `startPositionSec`; actual encoding begins on the segment boundary. Subtitle renditions are text-only; bitmap tracks have no text URL.

## HLS contract

The master contains **one video variant**, with optional subtitle renditions. HEVC uses fMP4 (`seg-N.m4s` plus `init.mp4`), H.264 uses MPEG-TS (`seg-N.ts`). Both video and subtitle playlists enumerate the whole duration, start at media sequence zero, and end with `EXT-X-ENDLIST` even before extraction/encoding finishes.

Finished video files are served immediately. A missing file can steer the encoder to the requested segment; ordinary playback near its head waits rather than starting another video encoder. The internal FFmpeg playlist `enc.m3u8` is not the public playlist. [Lifecycle](lifecycle.md) details timeouts and restart serialization.

## Integrations

The manager uses TMDB titles, stream recommendations, device/play database helpers, the event bus, and the source proxy. It records start/track decisions and final average speed/bitrate, and emits `session.start`, `session.update`, and `session.end`. Keep route shapes and database schema changes in the [API](../../api/index.md) and [data model](../../reference/data-models.md) documentation.

## Modification entry points

- Output compatibility: `decide`, `canKeepHdr`, `fitDimensions`, and `buildFfmpegArgs`.
- Track validation/restart criteria: `requireAudio`, `requireSubtitle`, `planPatch`.
- Seek/window behavior: `serve`, `ensureEncoder`, `restartAt`, `waitForFile`.
- Activity/resource policy: `ping`, `SessionMonitor`, and `planDiskCap`.
- Source lifetime changes: update `SourceHandle` ownership rather than resolving URLs independently.

## Measured scope and test evidence

Playback scope: **20 source `.ts` files** in `apps/server/src/playback`, **16 `*.test.ts` files** in `apps/server/test/playback` (12) and `apps/server/test/encode` (4), plus **2 helper `.ts` files**. Counts are recursive working-tree enumeration, excluding routes/shared/generated files. There is **1 unique committer** in `origin/main` for those three directories, deduplicated by `%cn <%ce>`; VeroxAUS is the sole human. This footprint is reused by the focused playback pages rather than pretending their overlapping modules form disjoint subsystems.

Read tests establish expected behavior for pure decisions, generated playlists, route validation, real-encoder output, track changes, seeks, and cleanup. They were **not run** during wiki generation; real encode tests require appropriate FFmpeg/GPU support.

## Key source files

| Repository-root path | Role |
| --- | --- |
| `apps/server/src/playback/manager.ts` | Session coordinator |
| `apps/server/src/playback/session.ts` | State and client projections |
| `apps/server/src/playback/playlist.ts` | Full-timeline HLS generation |
| `apps/server/src/playback/tracks.ts` | Valid track choices and restart plan |
| `apps/server/test/playback/sessions-routes.test.ts` | Session endpoint expectations |
| `apps/server/test/encode/hls-encode.test.ts` | Encoded media and playlist expectations |
