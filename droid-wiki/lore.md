# Lore: eight commits, one day

The available HEAD history contains **eight commits, all dated 2026-11-05**. This page groups that single recorded day into evidence-based implementation phases; these are not invented historical eras. Times are the commits' recorded author times in **UTC+11**. The snapshot ends at `b2a0afd75d49a46d24a6895ef17ce4d4f6d7ecaf`.

Evidence comes from `git log HEAD --reverse --format='%H|%aI|%s%n%b' --stat` and surviving source. Commit messages describe intent; current source establishes what remains. No release chronology, private design discussion, earlier unpublished work, or reason for choosing the project name is verified. See [by the numbers](by-the-numbers.md) for measurement rules and [architecture](overview/architecture.md) for the current system.

## 2026-11-05, 10:51–11:14: foundation, catalog and discovery

| Time | Commit | Recorded change and surviving evidence |
| --- | --- | --- |
| 10:51:13 | `9bc796fc51d919bcb2ec4555400ace81254c1822` | Creates the pnpm monorepo, Fastify foundation, SQLite migrations, configuration/redaction/logging, info/devices/events routes, mDNS and a minimal React/Vite page. Survives in `pnpm-workspace.yaml`, `apps/server/src/app.ts`, `apps/server/src/db/migrations.ts`, `apps/server/src/config.ts`, `apps/server/src/redact.ts`, `apps/server/src/logger.ts`, `apps/server/src/routes/info.ts`, `apps/server/src/routes/devices.ts`, `apps/server/src/routes/events.ts`, `apps/server/src/discovery.ts`, and `apps/web/src/App.tsx`. |
| 10:58:34 | `8b9ef2d5c09dd8e0a90f436d44fec0fd0c404827` | Adds TMDB metadata, SQLite caching and home/search/movie/TV/season routes. Current anchors: `apps/server/src/tmdb/service.ts`, `apps/server/src/tmdb/cache.ts`, `apps/server/src/tmdb/normalize.ts`, `apps/server/src/routes/catalog.ts`, and `packages/shared/src/catalog.ts`. |
| 11:14:57 | `cffb335045eb69c1d0ce0e1840010789564858dc` | Adds gateway access, filename parsing, stream ranking and stream routes. Current anchors: `apps/server/src/gateway/client.ts`, `apps/server/src/gateway/rateLimiter.ts`, `apps/server/src/streams/parse.ts`, `apps/server/src/streams/rank.ts`, `apps/server/src/streams/service.ts`, `apps/server/src/routes/streams.ts`, and `packages/shared/src/streams.ts`. |

The initial commit already contains all three present workspace manifests. The browser page was a placeholder at creation and remains one: `apps/web/src/App.tsx` says “The web UI is coming soon.” This is not evidence that an earlier complete UI was removed. The configured but absent `apps/desktop` entry in `pnpm-workspace.yaml` is likewise not evidence of a deleted desktop application.

## 2026-11-05, 11:51–13:35: playback grows controls and lifecycle

| Time | Commit | Recorded change and surviving evidence |
| --- | --- | --- |
| 11:51:44 | `10963663c0ad7e99c225eb0850d8ffd5a7407eea` | Introduces playback sessions, ffprobe-based decisions, FFmpeg HLS encoding, segment delivery and play records. Current anchors: `apps/server/src/playback/decision.ts`, `apps/server/src/playback/probe.ts`, `apps/server/src/playback/ffmpegArgs.ts`, `apps/server/src/playback/manager.ts`, `apps/server/src/routes/sessions.ts`, `apps/server/src/db/plays.ts`, and `packages/shared/src/playback.ts`. |
| 12:44:51 | `92c2f53a37f355b50b5095e1101f17ffbbfc1395` | Adds seek restarts, lifecycle monitoring, activity/stats, process recovery and disk-cap behavior. Surviving focused modules include `apps/server/src/playback/monitor.ts`, `apps/server/src/playback/pidRegistry.ts`, `apps/server/src/playback/segmentStore.ts`, `apps/server/src/playback/diskCap.ts`, `apps/server/src/playback/stats.ts`, and `apps/server/src/events/record.ts`. Startup still calls orphan recovery in `apps/server/src/index.ts`. |
| 13:35:02 | `d26acff82230c69865d9d563b2c31cc479d7911a` | Adds audio/subtitle selection, session patching, background WebVTT extraction and bitmap burn-in. Current anchors: `apps/server/src/playback/tracks.ts`, `apps/server/src/playback/subtitleExtractor.ts`, `apps/server/src/playback/ffmpegArgs.ts`, and `apps/server/src/routes/sessions.ts`. |

These changes build on the session manager introduced at 11:51; the recorded history does not establish a replacement playback architecture or a separate legacy product. Supporting tests remain under full paths such as `apps/server/test/encode/lifecycle.test.ts` and `apps/server/test/encode/tracks.test.ts`; their presence is not a claim that those tests passed during wiki generation.

## 2026-11-05, 15:26: source reuse and speculative warming

`97b6ed96ef390a3dda65b6c91f31fef64117ea27` at **15:26:12** adds the loopback source proxy, reusable probe results and `POST /api/prefetch`.

This is a concrete change to the byte-input boundary: the commit says ffprobe/FFmpeg input now passes through the loopback range cache. Current `apps/server/src/playback/manager.ts` accepts the proxy, while `apps/server/src/sourceproxy/proxy.ts` exposes source handles with playback/extractor URLs and a shared `probe()` result. Supporting implementation remains in `apps/server/src/sourceproxy/blockCache.ts`, `apps/server/src/sourceproxy/sourceEntry.ts`, `apps/server/src/sourceproxy/serve.ts`, and `apps/server/src/sourceproxy/upstream.ts`.

`apps/server/src/prefetch/service.ts` and `apps/server/src/routes/prefetch.ts` implement warming; `apps/server/src/app.ts` composes the proxy, playback and prefetch services. This verifies an integration change, not a claim of a measured startup-speed improvement or a rationale beyond the recorded reuse/warming behavior.

## 2026-11-05, 17:32: progressive subtitle renditions

`b2a0afd75d49a46d24a6895ef17ce4d4f6d7ecaf` at **17:32:43** changes `index.m3u8` into a master playlist, with `video.m3u8` as the media playlist and per-text-track subtitle renditions.

The current implementation makes this evolution explicit:

- `apps/server/src/playback/playlist.ts` defines `MASTER_PLAYLIST`, `VIDEO_PLAYLIST`, master generation and four-second subtitle playlists.
- `apps/server/src/playback/subtitleExtractor.ts` schedules extraction runs, capped at two concurrent runs.
- Newly added `apps/server/src/playback/subtitleRun.ts` tails growing WebVTT files and video-copy `framecrc` coverage.
- Newly added `apps/server/src/playback/subtitleStore.ts`, `apps/server/src/playback/intervals.ts`, and `apps/server/src/playback/vtt.ts` hold coverage/cues and render responses.
- `apps/server/src/playback/manager.ts` coordinates serving; `packages/shared/src/playback.ts` exposes subtitle status/full-file fields.
- `apps/server/test/encode/progressive-subtitles.test.ts` and `apps/server/test/playback/subtitles.test.ts` were added alongside the change.

The coverage-clock rationale is directly documented, rather than inferred: the commit body and the comment on `buildExtractArgs` in `apps/server/src/playback/subtitleRun.ts` explain that FFmpeg's output time follows the slowest output, so a sparse subtitle track can lag; the video-copy packet listing provides the coverage clock.

## What is oldest, and what actually changed?

All **52 paths introduced by the first commit still survive** in the tracked checkout. The earliest surviving areas are the workspace/tooling skeleton, shared capability/device/error/server contracts in `packages/shared/src/schemas.ts`, server bootstrap/composition/configuration, SQLite infrastructure, redaction/logging, discovery, basic HTTP/SSE routes, their tests, and the web placeholder.

Survival does not mean unchanged content. The later commits repeatedly extend `apps/server/src/app.ts` and `apps/server/src/context.ts` to wire new services; `apps/server/src/index.ts` gains recovery/proxy startup; `apps/server/src/db/migrations.ts` is extended during source-proxy/prefetch work; and `packages/shared/src/index.ts` grows its catalog, stream and playback re-exports. Playback itself appears later at 11:51, then gains lifecycle, tracks, proxy integration and progressive subtitles during the same day.

No deleted files were found with `git log --all --diff-filter=D --format='%h' --name-only`. File survival alone cannot prove feature survival, but the reviewed history and surviving source establish **no verified deprecated features and no verified major rewrite**. The master/media playlist change is a verified interface evolution, not evidence that subtitle support as a feature was abandoned.

The pre-existing uncommitted changes in `apps/server/src/playback/ffmpegArgs.ts` and `apps/server/test/playback/ffmpegArgs.test.ts` are outside these eight commits; their timing and rationale are not assigned a historical phase here. Continue with the [overview](overview/index.md) for the present scope.
