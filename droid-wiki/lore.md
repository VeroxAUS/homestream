# Lore

HomeStream's complete available history contains **97 commits**, from `c0781bd` on **2026-11-05** to **`5eefa37775db95b4bdd1e1dfe7b33cb8a9f31001`** on **2026-11-08**. In about 62 recorded hours, a server foundation grows into a playback pipeline, a browser player, and an Electron shell. See [architecture](overview/architecture.md) for the current system and [by the numbers](by-the-numbers.md) for measurement rules.

**Collection date: 2026-11-07**, as supplied. **Historical dates below are observed git committer timestamps normalized to UTC+11**, not a claim about the collection clock. HEAD records **2026-11-08 00:42:42 +11:00**, equivalent to **2026-11-07 13:42:42 UTC**. November 8 timestamps are preserved, not rewritten to fit the collection date.

Commit messages, changed paths, and inspected diffs support this account. They do not establish private prehistory, release publication times, or motivations absent from the record.

## Eras

These seven eras mark changes in focus inside a short history, not years of organizational development.

### 2026-11-05, 10:51–11:14: foundation and discovery

The root commit **`c0781bd`, 10:51**, creates the pnpm monorepo, Fastify server, SQLite persistence, device registration, events, mDNS discovery, and a minimal React/Vite placeholder. Three workspaces exist immediately: `apps/server/package.json`, `apps/web/package.json`, and `packages/shared/package.json`.

- **10:58, `da8062d`:** TMDB metadata and catalog routes arrive with SQLite caching (`apps/server/src/tmdb/service.ts`, `apps/server/src/tmdb/cache.ts`).
- **11:14, `73227ca`:** gateway discovery, stream parsing, and ranking arrive (`apps/server/src/gateway/client.ts`, `apps/server/src/streams/parse.ts`, `apps/server/src/streams/rank.ts`).

The browser page is scaffolding, not a former complete player. The server/shared boundary survives through HEAD. See [catalog](features/catalog.md).

### 2026-11-05 11:51–2026-11-06 13:25: managed playback and resource budgets

**`64b2054`, November 5 at 11:51**, adds session management, probe-driven decisions, FFmpeg HLS encoding, segment delivery, and play records. Current descendants include `apps/server/src/playback/manager.ts`, `apps/server/src/playback/decision.ts`, `apps/server/src/playback/ffmpegArgs.ts`, and `apps/server/src/db/plays.ts`.

- **November 5, 12:44, `c67be3b`:** seek restarts, lifecycle handling, encoder statistics, and a disk cap extend the pipeline (`apps/server/src/playback/monitor.ts`, `apps/server/src/playback/pidRegistry.ts`, `apps/server/src/playback/diskCap.ts`).
- **13:35, `f2e90f9`:** audio/subtitle selection, WebVTT extraction, and bitmap burn-in arrive (`apps/server/src/playback/tracks.ts`, `apps/server/src/playback/subtitleExtractor.ts`).
- **15:26, `88ffb52`:** FFprobe/FFmpeg inputs move behind a loopback range cache, and prefetch reuses probes (`apps/server/src/sourceproxy/proxy.ts`, `apps/server/src/sourceproxy/sourceEntry.ts`, `apps/server/src/prefetch/service.ts`).
- **17:32, `e257e71`:** progressive WebVTT replaces the direct media-playlist entry with a master playlist and separate video/subtitle renditions (`apps/server/src/playback/playlist.ts`, `apps/server/src/playback/subtitleStore.ts`). Its recorded rationale distinguishes sparse subtitle output time from extraction coverage, tracked using video-copy packet listings in `apps/server/src/playback/subtitleRun.ts`.
- **18:45, `951af22`:** a GPU health gate and sequential encode project arrive (`scripts/gpu-health.mjs`, `apps/server/vitest.config.ts`).
- **19:23, `c9284e5`:** the kept-HDR 2160p bitmap-subtitle path gains NVDEC support (`apps/server/src/playback/ffmpegArgs.ts`).
- **November 6, 01:13, `f6cb61d`:** a per-process memory watchdog arrives (`apps/server/src/playback/memoryWatchdog.ts`); **01:29, `f193d20`** bounds bitmap burn-in memory by resampling subtitles to the video rate (`apps/server/src/playback/ffmpegArgs.ts`).
- **12:13, `0e4da32`:** heavy-source extractors gain encoder-progress pacing (`apps/server/src/playback/extractorSchedule.ts`).
- **13:18, `963572e`:** shared download capping and read-ahead arrive (`apps/server/src/network/downloadGate.ts`, `apps/server/src/network/readAhead.ts`).
- **13:25, `7be7179`:** playback is limited to two concurrent sessions (`apps/server/src/playback/manager.ts`).

These changes constrain the same media engine; they are not a stack replacement. See [playback](systems/playback/index.md), [source proxy](systems/source-proxy.md), and [network controls](systems/network.md). No GPU benchmark was run for this narrative.

### 2026-11-06, 13:56–17:34: recovery and persistent viewing state

- **13:56–13:58, `5a4e9ab` and `cb96b13`:** the generated wiki and scheduled refresh workflow enter the repository (`docs/wiki.md`, `.github/workflows/droid-wiki-refresh.yml`).
- **14:19, `24250c7`:** WEB-DL-first preference replaces remux-first ranking within a resolution tier, alongside gateway-placeholder detection and automatic cached-source fallback (`apps/server/src/streams/rank.ts`, `apps/server/src/playback/resolveUrl.ts`). The ranking diff explicitly favors smaller sources for startup and download cost; it is not a benchmark.
- **14:28, `b96f896`:** server-selected default subtitles arrive (`apps/server/src/playback/defaultSubtitle.ts`).
- **14:51, `e906f95`:** progress, continue watching, history, statistics, and the home banner add persistent viewing behavior (`apps/server/src/progress/service.ts`, `apps/server/src/stats/aggregate.ts`, `apps/server/src/home/service.ts`).
- **15:15, `20d1ce2`:** health checks, log access, and SSE health snapshots arrive (`apps/server/src/health/service.ts`, `apps/server/src/routes/health.ts`, `apps/server/src/routes/events.ts`).
- **15:37, `4336e69`:** TorBox caching handles titles without a usable cached stream (`apps/server/src/downloads/service.ts`, `apps/server/src/downloads/store.ts`).
- **17:34, `1e66f31`:** the download gate keeps low-lead state between requests, shutdown becomes bounded, and playback-start timings become visible (`apps/server/src/network/downloadGate.ts`, `apps/server/src/shutdown.ts`, `apps/server/src/playback/startTimeline.ts`). The commit identifies an open event-stream response blocking shutdown.

See [downloads](features/downloads.md) and [viewing progress](features/viewing-progress.md).

### 2026-11-06 17:54–2026-11-07 01:25: gates, operations, and privacy corrections

Repository automation grows alongside product behavior.

- **November 6, 17:54, `48e1108`**, followed by **17:55, `bacce15`**: quality configurations/hooks and repository-wide formatting (`eslint.config.mjs`, `lefthook.yml`, `scripts/install-hooks.mjs`).
- **18:00, `a402734`:** separate unit, integration, GPU, and live tiers replace the mixed test layout; coverage thresholds and CI reporters arrive (`apps/server/vitest.config.ts`, `apps/server/coverage-thresholds.json`, `scripts/vitest-flaky-reporter.mjs`).
- **18:43, `753f30f`:** maintained architecture/runbooks, agent guidance, and API/documentation tooling expand (`AGENTS.md`, `docs/architecture.md`, `scripts/check-docs.mjs`).
- **20:03, `e62008d`:** request IDs, metrics, operational probes, optional telemetry, flags, and alerts arrive (`apps/server/src/http/observability.ts`, `apps/server/src/routes/ops.ts`, `apps/server/src/telemetry/index.ts`, `packages/shared/src/analytics.ts`, `monitoring/prometheus/alerts.yml`).
- **20:52, `24f815e`:** CI/release automation and readiness auditing arrive (`.github/workflows/ci.yml`, `.github/workflows/release.yml`, `scripts/readiness-audit.mjs`).
- **21:12–21:22, `b7b16c3`, `bd42b67`, `dae39f0`:** Linux portability, worker sizing, and environment-sensitive bandwidth assertions receive corrections (`vitest.shared.ts`, `apps/server/test/sourceproxy/bandwidthCap.test.ts`).
- **21:55, `9ef0c98`**, and **22:08, `bb48e6d`**: CodeQL scanning and security/dependency fixes affect `.github/workflows/codeql.yml`, `packages/shared/src/sanitize.ts`, `scripts/check-docs.mjs`, and `pnpm-workspace.yaml`.
- **22:49, `2a4591b`**, and **November 7, 00:03, `fbe2ed2`**: readiness fixes cover task dependencies, secret scanning, flags, smoke/alert tools, wiki publishing, agent fences, and API documentation (`turbo.json`, `scripts/pre-commit-secrets.mjs`, `scripts/flags.mjs`, `scripts/sentry-alerts.mjs`, `scripts/wiki-mirror.mjs`, `apps/server/src/docs/openapi.ts`).
- **00:39, `9fe4d6e`**, and **01:25, `c4e3293`**: telemetry sanitization addresses IP/geo inference, with an empty `user.geo` added after the earlier inference setting alone was described as insufficient (`packages/shared/src/sanitize.ts`, `docs/PRIVACY.md`).

These are successive privacy corrections, not proof that the earlier mechanism was complete. Upstream ingestion settings were not tested for this wiki. See [tooling](how-to-contribute/tooling.md) and [telemetry](systems/telemetry.md).

### 2026-11-07, 03:00–05:57: client foundations become a routed browser UI

**03:00, `f252d00`**, adds the fourth workspace, `apps/desktop/package.json`, plus web/desktop request IDs, logging, telemetry support, tests, and bundle budgets. `packages/shared/src/identity.ts` supplies a random installation identity. At this point desktop is support infrastructure, not yet a running Electron shell.

- **03:13, `592cb10`:** Playwright configuration becomes loadable without an already-built server (`apps/web/playwright.config.ts`).
- **05:15, `b5c71c9`:** a real route tree replaces the browser placeholder: Home, search, movie/show details, Settings, device registration, SSE download invalidation, and desktop-oriented navigation (`apps/web/src/App.tsx`, `apps/web/src/api/queries.ts`, `apps/web/src/device/identity.ts`, `apps/web/src/events/serverEvents.ts`, `apps/web/src/components/Nav.tsx`). Episode progress lookup and static asset caching extend `apps/server/src/routes/progress.ts` and `apps/server/src/routes/static.ts`.
- **05:57, `7eb94ba`:** heavy-source burst timing starts after encoder warm-up (`apps/server/src/playback/extractorSchedule.ts`, `apps/server/src/playback/subtitleExtractor.ts`). The commit describes a roughly 20–25-second warm-up consuming a 25-second burst window before useful bursting began.

This is the earlier wiki snapshot, not the current implementation boundary: the browser player and real desktop shell arrive later that day.

### 2026-11-07, 14:02–18:46: playback is split and safety becomes explicit

- **14:02, `33d5e2c`**, and **14:18, `b6c77c3`**: downloads cannot be marked ready without a cached stream, probing reuses the playback target, and the gateway's downloading clip is rejected rather than played (`apps/server/src/downloads/rules.ts`, `apps/server/src/downloads/service.ts`, `apps/server/src/gateway/playbackProbe.ts`, `apps/server/src/playback/placeholder.ts`, `apps/server/src/playback/resolveUrl.ts`).
- **14:40, `2d60a28`:** the playback manager becomes a facade over focused modules. `apps/server/src/playback/manager.ts` shrinks from **1,562 to 305 physical lines**. Session slots, startup, encoder lifecycle, recovery, subtitle handoff, HLS serving, and pacing move into `apps/server/src/playback/sessionSlots.ts`, `apps/server/src/playback/sessionStart.ts`, `apps/server/src/playback/encoderLifecycle.ts`, `apps/server/src/playback/recovery.ts`, `apps/server/src/playback/subtitleHandoff.ts`, `apps/server/src/playback/hlsServing.ts`, and `apps/server/src/playback/readAheadPacing.ts`. Characterization tests accompany the split.
- The same commit adds 400-line file / 80-line function limits and a baseline ratchet (`eslint.config.mjs`, `code-limits.baseline.json`, `scripts/code-limits.mjs`). Physical-line measurements here include blanks/comments; the enforced code limits use their own counting rules.
- **14:55, `7b5bfd6`:** encoder/extractor launches are serialized and failed explicit starts are recorded (`apps/server/src/playback/sessionSlots.ts`, `apps/server/src/playback/subtitleExtractor.ts`, `apps/server/src/playback/sessionStart.ts`).
- **15:14, `a3547a8`:** read-ahead becomes per-session on shared sources, evicted prefetch entries are restarted, and invalid limit pairs return together to 180/120 (`apps/server/src/sourceproxy/readerHolds.ts`, `apps/server/src/prefetch/service.ts`, `apps/server/src/network/limits.ts`).
- **15:40, `e3aafec`:** waiting subtitle extractors gain a minimum 20% capped-link share while encoder lead is healthy; low-lead encoders retain priority, and subtitle preroll falls from 40 to 12 seconds (`apps/server/src/network/downloadGate.ts`, `apps/server/src/playback/subtitleExtractor.ts`).
- **16:06, `a6e1384`**, followed by **16:51, `43dfdf6`**: extractor lead is controlled by read position and cache capacity, and concurrent readers share range downloads (`apps/server/src/playback/extractorWindow.ts`, `apps/server/src/sourceproxy/serve.ts`, `apps/server/src/sourceproxy/sourceEntry.ts`).
- **16:15, `945d1ba`**, and **18:04, `9088bf4`**: the GPU gate fails closed on missing/unsafe conditions and narrows FFmpeg ownership to an owned-root path or process-specific registry entry (`scripts/gpu-health.mjs`, `scripts/gpu-health-ffmpeg.mjs`, `apps/server/src/playback/subtitleRun.ts`).
- **16:24, `e62a10b`:** kept HLG receives real HLG-to-PQ conversion and audio switches preserve the master playlist (`apps/server/src/playback/ffmpegArgs.ts`, `apps/server/src/playback/hlsServing.ts`).
- **16:30, `49b8072`**, and **17:44, `06d863b`**: ranking gains 1440p and side-based device tiers, avoids unknown-over-known resolution preference, and honors explicit pixel heights (`apps/server/src/streams/parse.ts`, `apps/server/src/streams/rank.ts`).
- **17:03, `1ba655d`:** discard stops change from immediate force-kill to input cut plus a short graceful exit, then tree kill if needed (`apps/server/src/playback/discardStop.ts`, `apps/server/src/sourceproxy/inputCuts.ts`).
- **18:17, `2235266`**, and **18:46, `c528e32`**: stuck encoders keep their reservation until exit; replacements and fallback candidates cannot exceed capacity, and stuck-stop events become visible in logs (`apps/server/src/playback/sessionSlots.ts`, `apps/server/src/playback/killUntilExited.ts`, `apps/server/src/playback/stuckStop.ts`).

This is a structural refactor followed by corrections to resource ownership, not evidence of a new transcoding architecture. See [playback lifecycle](systems/playback/lifecycle.md).

### 2026-11-07 19:22–2026-11-08 00:42: real clients and newest-answer correctness

**November 7, 19:58, `72b7322`**, replaces the player placeholder with HLS playback, automatic session starts (`streamId: "auto"`), subtitle/audio menus, progress pings, keyboard controls, Media Session, download notices, and detail/episode prefetch (`apps/web/src/pages/PlayerPage.tsx`, `apps/web/src/player/Playback.tsx`, `apps/web/src/player/usePlaybackModel.ts`, `apps/web/src/player/sessionApi.ts`). **20:06, `8dd31ff`**, refreshes Home and saved progress after playback ends.

**21:16, `890e841`**, makes desktop a running Electron shell: single instance, tray, owned-or-attached server supervisor, frameless window, loading/failure page, mini-player session handoff, keep-awake, notifications, and validated preload bridge (`apps/desktop/src/main.ts`, `apps/desktop/src/shell/shell.ts`, `apps/desktop/src/supervisor.ts`, `apps/desktop/src/preload.cts`, `apps/desktop/src/miniPlayer.ts`, `packages/shared/src/desktop.ts`). Desktop-only settings and first-run/unreachable views join the renderer. The commit adds a Windows launch smoke test; this wiki does not claim to have run it.

**21:38, `8861128`**, adds error boundaries and closes a mini player whose session disappears (`apps/web/src/components/ErrorBoundary.tsx`, `apps/web/src/desktop/useAttachedSession.ts`).

**22:07, `635eab1`**, introduces three advisory automations: Droid review, historical CI timing, and daily code-health review (`.github/workflows/droid-review.yml`, `.github/workflows/code-health.yml`, `.github/workflows/ci.yml`, `scripts/ci-timing.mjs`, `docs/ci.md`). Subsequent commits narrow review tools to reads (**22:25, `d7436fb`**) and repair sticky-summary cleanup/workflow execution (**22:39–23:13, `08095a0` through `eca6148`**). The workflow records timing on the separate `ci-metrics` branch; it does not add those records to application source.

The last corrections make asynchronous state and resource handoff explicit:

- **23:35, `13fbeda`:** paused sessions continue pinging; leaving before metadata no longer overwrites resume position with zero; handoff preserves client subtitle choice; attached-session Retry starts a replacement; supervisor operations serialize (`apps/web/src/player/useSessionLifetime.ts`, `apps/web/src/desktop/useAttachedSession.ts`, `apps/desktop/src/supervisor.ts`).
- **23:54, `704c406`:** plain-HTTP LAN origins receive a UUID fallback, and opening the event stream reconciles health (`apps/web/src/lib/uuid.ts`, `apps/web/src/events/serverEvents.ts`).
- **November 8, 00:08, `887d4f7`:** buffering overlays stop intercepting controls, interleaved prefetch deduplicates each title, labels gain 1440p, and Retry waits for the old session's DELETE before requesting its replacement (`apps/web/src/player/PlayerOverlays.module.css`, `apps/web/src/player/sessionApi.ts`, `apps/web/src/player/decisionText.ts`). `apps/web/e2e/player-input.spec.ts` adds Chromium hit-testing coverage.
- **00:14, `9a9a0df`:** errored sessions no longer count as active and late activity snapshots cannot resurrect ended sessions (`apps/desktop/src/monitor.ts`, `apps/desktop/test/monitor.test.ts`).
- **00:21, `d1e9ce7`:** timing records cover every main run and every push gets a Droid summary (`.github/workflows/ci.yml`, `.github/workflows/droid-review.yml`).
- **00:27, `989dbcc`:** release automation skips a commit already contained by a newer release tag, addressing CI runs finishing out of order (`scripts/next-version.mjs`, `apps/server/test/scripts/nextVersion.test.ts`). This describes a guard, not evidence of a particular published release.
- **00:42, `5eefa37`:** stream-open health snapshots run through the shared health query; both stream opens and pushed health updates cancel older requests so late success/failure cannot replace newer state (`apps/web/src/events/serverEvents.ts`, `apps/web/src/components/HealthPill.tsx`, `apps/web/src/events/events.test.tsx`).

Health has a specific sequence: **19:22 November 7, `2da75a6`**, stops polling while SSE is live; `704c406` then adds open-time reconciliation; HEAD closes the race with stale in-flight requests. These are successive fixes, not three names for an unchanged implementation.

At HEAD the browser player and desktop shell are implemented. Dashboard tabs still use `apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`; TV remains planned with no workspace. See [web](apps/web/index.md) and [desktop](apps/desktop/index.md).

## Longest-standing features

“Later changes” counts subsequent reachable commits touching the path after its first introduction. Directory scopes are recursive; formatting counts. These are path-history counts, not semantic rewrite counts.

| Surviving feature | Introduced, UTC+11 | Later changes through HEAD | Current evidence scope |
| --- | --- | ---: | --- |
| mDNS discovery | 2026-11-05 10:51, `c0781bd` | 0 | `apps/server/src/discovery.ts` |
| Device registration | 2026-11-05 10:51, `c0781bd` | 0 | `apps/server/src/routes/devices.ts` |
| Shared base contracts | 2026-11-05 10:51, `c0781bd` | 3 | `packages/shared/src/schemas.ts` |
| SQLite migration chain | 2026-11-05 10:51, `c0781bd` | 3 | `apps/server/src/db/migrations.ts` |
| Service composition | 2026-11-05 10:51, `c0781bd` | 17 | `apps/server/src/app.ts` |
| TMDB catalog | 2026-11-05 10:58, `da8062d` | 6 | `apps/server/src/tmdb` |
| Parsing/ranking | 2026-11-05 11:14, `73227ca` | 7 | `apps/server/src/streams` |
| Playback pipeline | 2026-11-05 11:51, `64b2054` | 36 | `apps/server/src/playback` |
| Shared source cache | 2026-11-05 15:26, `88ffb52` | 16 | `apps/server/src/sourceproxy` |
| Prefetch | 2026-11-05 15:26, `88ffb52` | 4 | `apps/server/src/prefetch` |

Discovery and device-registration files survive untouched at their original paths. Playback has evolved repeatedly; persistence of its directory does not imply unchanged internals.

## Replaced behavior with evidence

No complete server-stack, language, or retired TV-app replacement is established. Verified narrower replacements are:

| Former behavior | Replacement date / commit | Replacement and current evidence |
| --- | --- | --- |
| Direct upstream encoder/probe inputs introduced by `64b2054` | 2026-11-05, `88ffb52` | Shared loopback range cache, `apps/server/src/sourceproxy/proxy.ts` |
| Direct video media-playlist entry introduced by `64b2054` | 2026-11-05, `e257e71` | Master plus media/subtitle playlists, `apps/server/src/playback/playlist.ts` |
| Remux-first ordering introduced by `73227ca` | 2026-11-06, `24250c7` | WEB-DL-first ordering, `apps/server/src/streams/rank.ts` |
| Mixed unit/route integration layout | 2026-11-06, `a402734` | Separate test tiers, `apps/server/vitest.config.ts` |
| Browser placeholder introduced by `c0781bd` | 2026-11-07, `b5c71c9` | Routed catalog/settings UI, `apps/web/src/App.tsx` |
| Heavy-source burst clock starts before warm-up ends | 2026-11-07, `7eb94ba` | Clock deferred until warm-up, `apps/server/src/playback/extractorSchedule.ts` |
| Monolithic playback manager | 2026-11-07, `2d60a28` | Facade and focused modules, `apps/server/src/playback/manager.ts` |
| Immediate force-kill discard path from `bd131f1` on November 7 | 2026-11-07, `1ba655d` | Input cut, short graceful stop, then kill if needed, `apps/server/src/playback/discardStop.ts` |
| Browser player placeholder | 2026-11-07, `72b7322` | HLS player, `apps/web/src/player/Playback.tsx` |
| Desktop support-only workspace from `f252d00` | 2026-11-07, `890e841` | Running shell, `apps/desktop/src/main.ts` |
| Independent open-time health snapshot races older query | 2026-11-08, `5eefa37` | Shared query/cancellation/latest-answer reconciliation, `apps/web/src/events/serverEvents.ts` |

Test paths removed during the tier split were largely moved, not abandoned. Export cleanup is not evidence that whole features were deleted. Where the record does not explain motivation, none is invented here.

## Major refactors and large additions

Numeric churn follows the [statistics exclusions](by-the-numbers.md#measurement-scope), including disabled rename detection. These are large changesets, not all rewrites.

| Date, UTC+11 | Commit | Paths with numeric churn | Added | Deleted | Change |
| --- | --- | ---: | ---: | ---: | --- |
| 2026-11-06 18:00 | `a402734` | 113 | 5,623 | 5,198 | Test-tier moves, coverage/reporting, export cleanup |
| 2026-11-06 17:55 | `bacce15` | 171 | 5,371 | 1,828 | Repository-wide formatting |
| 2026-11-07 05:15 | `b5c71c9` | 114 | 6,919 | 129 | Browser placeholder replaced by routed UI |
| 2026-11-06 20:03 | `e62008d` | 79 | 5,440 | 42 | Observability, telemetry, flags, alerts |
| 2026-11-07 14:40 | `2d60a28` | 22 | 2,690 | 1,398 | Playback manager split and size ratchet |
| 2026-11-07 19:58 | `72b7322` | 60 | 5,252 | 29 | Browser player, play flow, prefetch |
| 2026-11-07 21:16 | `890e841` | 107 | 7,918 | 110 | Desktop shell and renderer integration |
| 2026-11-07 22:07 | `635eab1` | 28 | 3,120 | 2 | Advisory review, timing, code-health automation |

The test-tier split's large deletions mostly reflect moves; formatting is not an architecture replacement. The manager split is a genuine decomposition while retaining `PlaybackManager` as the entry facade. Browser-player and desktop-shell additions are new capabilities rather than evidence of discarded earlier full applications.

## Growth trajectory

Each checkpoint reads its own committed tree, using the statistics page's exclusions and physical-line definition. Total lines include tests, docs, configuration, comments, and blanks; source lines use the ordered source classification. Growth is not a contributor ranking or a claim of team expansion.

| Checkpoint, UTC+11 | Commit | Included text files | Total physical lines | Source physical lines | Workspaces |
| --- | --- | ---: | ---: | ---: | ---: |
| 2026-11-05 10:51, foundation | `c0781bd` | 51 | 2,151 | 1,054 | 3 |
| 2026-11-05 15:26, proxy/prefetch | `88ffb52` | 129 | 12,722 | 6,516 | 3 |
| 2026-11-06 18:00, test tiers | `a402734` | 277 | 33,221 | 14,796 | 3 |
| 2026-11-06 20:03, observability | `e62008d` | 374 | 42,949 | 18,388 | 3 |
| 2026-11-07 03:00, desktop support | `f252d00` | 466 | 51,363 | 20,825 | 4 |
| 2026-11-07 05:15, routed browser UI | `b5c71c9` | 550 | 58,157 | 25,211 | 4 |
| 2026-11-07 14:40, manager split | `2d60a28` | 575 | 60,648 | 26,035 | 4 |
| 2026-11-07 19:58, browser player | `72b7322` | 657 | 71,707 | 30,437 | 4 |
| 2026-11-07 21:16, Electron shell | `890e841` | 730 | 79,856 | 35,293 | 4 |
| 2026-11-08 00:42, current HEAD | `5eefa37` | 761 | 84,651 | 37,168 | 4 |

The three original workspaces begin on November 5. Desktop support adds the fourth on November 7; a functioning shell follows later that day. At HEAD, test/support lines (**40,352**) exceed source lines (**37,168**), so repository growth cannot be explained as product code alone.

Path introductions and later-change counts can be reproduced with `git log --reverse --format='%h %cI %s' HEAD -- <repo-root-path>`; count entries after the first. Growth reads committed blobs at each checkpoint, not the working tree. No dependencies were installed and no application, live service, encoder, or test suite was run to construct this history.
