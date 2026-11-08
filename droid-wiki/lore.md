# Lore

HomeStream's complete available history contains **109 commits**, from `c0781bd` on **2026-11-05** to **`0a8f04fd81cfaa7ca5d1689550ad207e7fc0d3ae`** on **2026-11-08**. In about 79 recorded hours, a server foundation grows into a media pipeline, browser player, Electron shell, and richer browsing/settings UI. See [architecture](overview/architecture.md) for the current system and [by the numbers](by-the-numbers.md) for measurement rules.

**Collected 2026-11-08.** Historical dates below are **git committer timestamps normalized to UTC+11**. The endpoints are **November 5 at 10:51:13** and **November 8 at 18:16:27**. The checkout is not shallow, but its history is short: it does not establish private prehistory, release-publication times, team growth, or undocumented motives.

## Eight short eras

These are changes of focus within four calendar dates, not years of organizational development.

### November 5, 10:51–11:14: foundation and discovery

The root commit **`c0781bd`, 10:51**, creates the pnpm monorepo, Fastify server, SQLite persistence, device registration, events, mDNS discovery, and a small React/Vite placeholder. The original three workspaces are represented by `apps/server/package.json`, `apps/web/package.json`, and `packages/shared/package.json`.

- **10:58, `da8062d`:** TMDB metadata and catalog routes arrive with SQLite caching (`apps/server/src/tmdb/service.ts`, `apps/server/src/tmdb/cache.ts`).
- **11:14, `73227ca`:** gateway discovery, stream parsing, and ranking arrive (`apps/server/src/gateway/client.ts`, `apps/server/src/streams/parse.ts`, `apps/server/src/streams/rank.ts`).

The browser page is scaffolding, not a complete earlier player. The server/shared boundary survives. See [catalog](features/catalog.md).

### November 5, 11:51–November 6, 13:25: managed playback and budgets

**November 5, 11:51, `64b2054`**, adds playback sessions, probe-driven decisions, FFmpeg HLS encoding, segment delivery, and play records. Current descendants include `apps/server/src/playback/manager.ts`, `apps/server/src/playback/decision.ts`, `apps/server/src/playback/ffmpegArgs.ts`, and `apps/server/src/db/plays.ts`.

- **November 5, 12:44, `c67be3b`:** seeking, lifecycle handling, encoder statistics, and a disk cap extend the pipeline (`apps/server/src/playback/monitor.ts`, `apps/server/src/playback/diskCap.ts`).
- **13:35, `f2e90f9`:** audio/subtitle selection, WebVTT extraction, and bitmap burn-in arrive (`apps/server/src/playback/tracks.ts`, `apps/server/src/playback/subtitleExtractor.ts`).
- **15:26, `88ffb52`:** the loopback range cache and prefetch/probe reuse arrive (`apps/server/src/sourceproxy/proxy.ts`, `apps/server/src/prefetch/service.ts`).
- **17:32, `e257e71`:** progressive WebVTT introduces a master playlist and separate video/subtitle renditions (`apps/server/src/playback/playlist.ts`, `apps/server/src/playback/subtitleRun.ts`).
- **18:45, `951af22`**, and **19:23, `c9284e5`:** GPU safety tooling and the kept-HDR 2160p NVDEC burn-in path arrive (`scripts/gpu-health.mjs`, `apps/server/src/playback/ffmpegArgs.ts`).
- **November 6, 01:13, `f6cb61d`**, and **01:29, `f193d20`:** per-process memory monitoring and bitmap subtitle resampling address resource bounds (`apps/server/src/playback/memoryWatchdog.ts`, `apps/server/src/playback/ffmpegArgs.ts`).
- **12:13, `0e4da32`:** heavy-source subtitle extraction gains encoder-progress pacing (`apps/server/src/playback/extractorSchedule.ts`).
- **13:18, `963572e`**, and **13:25, `7be7179`:** shared download capping/read-ahead and a two-session limit arrive (`apps/server/src/network/downloadGate.ts`, `apps/server/src/network/readAhead.ts`, `apps/server/src/playback/manager.ts`).

This is progressive constraint of one media engine, not a stack replacement. See [playback](systems/playback/index.md), [source proxy](systems/source-proxy.md), and [network controls](systems/network.md). No GPU benchmark was run for this narrative.

### November 6, 14:19–17:34: recovery and persistent viewing state

- **14:19, `24250c7`:** WEB-DL-first preference replaces remux-first ordering within a resolution tier; placeholder detection and automatic cached-source fallback arrive (`apps/server/src/streams/rank.ts`, `apps/server/src/playback/resolveUrl.ts`). The ranking diff explicitly favors smaller sources for startup/download cost; this is recorded rationale, not a measured benchmark.
- **14:28, `b96f896`:** the server selects default subtitles (`apps/server/src/playback/defaultSubtitle.ts`).
- **14:51, `e906f95`:** progress, continue watching, history, statistics, and the home banner add persistent viewing behavior (`apps/server/src/progress/service.ts`, `apps/server/src/stats/aggregate.ts`, `apps/server/src/home/service.ts`).
- **15:15, `20d1ce2`:** health checks, log access, and SSE health snapshots arrive (`apps/server/src/health/service.ts`, `apps/server/src/routes/health.ts`, `apps/server/src/routes/events.ts`).
- **15:37, `4336e69`:** TorBox tracking supports titles without a usable cached stream (`apps/server/src/downloads/service.ts`, `apps/server/src/downloads/store.ts`).
- **17:34, `1e66f31`:** download gating becomes lead-aware, shutdown is bounded, and playback-start timings are logged (`apps/server/src/network/downloadGate.ts`, `apps/server/src/shutdown.ts`, `apps/server/src/playback/startTimeline.ts`).

See [downloads](features/downloads.md) and [viewing progress](features/viewing-progress.md).

### November 6, 17:54–November 7, 01:25: quality gates and operations

- **November 6, 17:54, `48e1108`**, then **17:55, `bacce15`**: quality configurations/hooks and repository-wide formatting arrive (`eslint.config.mjs`, `lefthook.yml`, `scripts/install-hooks.mjs`).
- **18:00, `a402734`:** four explicit test tiers, coverage thresholds, and CI reporting replace the mixed layout (`apps/server/vitest.config.ts`, `apps/server/coverage-thresholds.json`, `scripts/vitest-flaky-reporter.mjs`).
- **18:43, `753f30f`:** maintained architecture/runbooks, agent guidance, and documentation tooling expand (`AGENTS.md`, `docs/architecture.md`, `scripts/check-docs.mjs`).
- **20:03, `e62008d`:** request IDs, metrics, operational probes, optional telemetry, flags, and alerts arrive (`apps/server/src/http/observability.ts`, `apps/server/src/routes/ops.ts`, `packages/shared/src/analytics.ts`, `monitoring/prometheus/alerts.yml`).
- **20:52, `24f815e`:** CI/release automation and readiness auditing arrive (`.github/workflows/ci.yml`, `.github/workflows/release.yml`, `scripts/readiness-audit.mjs`). Linux/worker corrections follow at **21:12–21:22** (`b7b16c3`, `bd42b67`, `dae39f0`; `vitest.shared.ts`, `apps/server/test/sourceproxy/bandwidthCap.test.ts`).
- **November 7, 00:39, `9fe4d6e`**, and **01:25, `c4e3293`:** successive telemetry changes address ingestion IP/geo inference, including an empty Sentry `user.geo` (`packages/shared/src/sanitize.ts`, `docs/PRIVACY.md`).

These are implementation changes and corrections, not proof of upstream ingestion behavior. See [tooling](how-to-contribute/tooling.md) and [telemetry](systems/telemetry.md). The generated wiki itself first appears earlier, **November 6 at 13:56, `5a4e9ab`**, followed by its refresh workflow at **13:58, `cb96b13`** (`docs/wiki.md`, `.github/workflows/droid-wiki-refresh.yml`).

### November 7, 03:00–05:57: clients become a routed browser UI

**03:00, `f252d00`**, adds the fourth workspace, `apps/desktop/package.json`, with web/desktop request IDs, logging, telemetry support, tests, and budgets. This is desktop support infrastructure, not yet the running Electron shell.

**05:15, `b5c71c9`**, replaces the browser placeholder with a route tree for Home, search, movie/show details, Settings, and desktop-oriented navigation. Device registration and SSE download invalidation join the client (`apps/web/src/App.tsx`, `apps/web/src/api/queries.ts`, `apps/web/src/device/identity.ts`, `apps/web/src/events/serverEvents.ts`).

**05:57, `7eb94ba`**, defers the heavy-source extractor burst clock until after warm-up (`apps/server/src/playback/extractorSchedule.ts`). The commit records that warm-up had consumed most of the burst window; no fresh timing experiment is implied here.

### November 7, 14:02–18:46: playback decomposition and ownership

**14:02, `33d5e2c`**, and **14:18, `b6c77c3`**, tighten cached-stream readiness and reject the gateway's downloading clip (`apps/server/src/downloads/service.ts`, `apps/server/src/gateway/playbackProbe.ts`, `apps/server/src/playback/placeholder.ts`).

**14:40, `2d60a28`**, is the clearest structural rewrite: `apps/server/src/playback/manager.ts` shrinks from **1,562 to 305 physical lines**. Its responsibilities move into focused modules, including:

- `apps/server/src/playback/sessionSlots.ts` and `apps/server/src/playback/sessionStart.ts`.
- `apps/server/src/playback/encoderLifecycle.ts` and `apps/server/src/playback/recovery.ts`.
- `apps/server/src/playback/subtitleHandoff.ts` and `apps/server/src/playback/hlsServing.ts`.
- `apps/server/src/playback/readAheadPacing.ts`.

The facade survives and is **321 physical lines** at the measured commit. The same changeset adds file/function limits and a baseline ratchet (`eslint.config.mjs`, `code-limits.baseline.json`, `scripts/code-limits.mjs`); their enforcement uses different counting rules from physical lines.

Subsequent commits refine ownership rather than replace transcoding:

- **14:55, `7b5bfd6`:** encoder/extractor launches serialize (`apps/server/src/playback/sessionSlots.ts`, `apps/server/src/playback/subtitleExtractor.ts`).
- **15:14, `a3547a8`:** per-session read-ahead and evicted-prefetch handling improve (`apps/server/src/sourceproxy/readerHolds.ts`, `apps/server/src/prefetch/service.ts`).
- **15:40, `e3aafec`**, **16:06, `a6e1384`**, and **16:51, `43dfdf6`:** subtitle bandwidth sharing, shared range downloads, and cache-bounded extractor lead evolve (`apps/server/src/network/downloadGate.ts`, `apps/server/src/sourceproxy/sourceEntry.ts`, `apps/server/src/playback/extractorWindow.ts`).
- **16:24, `e62a10b`:** kept HLG gets real HLG-to-PQ conversion; audio switches preserve the master playlist (`apps/server/src/playback/ffmpegArgs.ts`, `apps/server/src/playback/hlsServing.ts`).
- **16:30, `49b8072`**, and **17:44, `06d863b`:** resolution ranking gains 1440p and side-based device tiers (`apps/server/src/streams/parse.ts`, `apps/server/src/streams/rank.ts`).
- **17:03, `1ba655d`:** discard stops cut input and try a short graceful exit before tree-kill, replacing the immediate-kill change from **15:02, `bd131f1`** (`apps/server/src/playback/discardStop.ts`).
- **18:17, `2235266`**, and **18:46, `c528e32`:** stuck encoders retain their reservation; replacements/fallbacks cannot create a third encoder (`apps/server/src/playback/sessionSlots.ts`, `apps/server/src/playback/killUntilExited.ts`, `apps/server/src/playback/stuckStop.ts`).

See [playback lifecycle](systems/playback/lifecycle.md).

### November 7, 19:22–November 8, 00:42: real clients and newest-answer correctness

**November 7, 19:58, `72b7322`**, replaces the player placeholder with HLS playback, automatic session starts, subtitle/audio controls, progress pings, keyboard/Media Session support, and prefetch (`apps/web/src/pages/PlayerPage.tsx`, `apps/web/src/player/Playback.tsx`, `apps/web/src/player/sessionApi.ts`). **20:06, `8dd31ff`**, refreshes Home and saved progress after playback ends.

**21:16, `890e841`**, makes desktop a running Electron shell with tray, owned-or-attached server supervision, frameless windows, mini-player handoff, keep-awake, notifications, and a validated preload bridge (`apps/desktop/src/main.ts`, `apps/desktop/src/supervisor.ts`, `apps/desktop/src/preload.cts`, `apps/desktop/src/miniPlayer.ts`, `packages/shared/src/desktop.ts`). The commit adds a launch smoke test; this refresh did not run it.

**22:07, `635eab1`**, adds advisory Droid review, historical CI timing, and daily code-health review (`.github/workflows/droid-review.yml`, `.github/workflows/code-health.yml`, `scripts/ci-timing.mjs`). Later corrections narrow review tools and repair summary cleanup/workflow execution; those are automation changes, not new media capabilities.

Client/resource corrections follow:

- **23:35, `13fbeda`:** paused sessions stay alive, handoff preserves subtitle choice, attached-session Retry works, and supervisor restarts serialize (`apps/web/src/player/useSessionLifetime.ts`, `apps/web/src/desktop/useAttachedSession.ts`, `apps/desktop/src/supervisor.ts`).
- **23:54, `704c406`:** a UUID fallback supports plain-HTTP LAN origins (`apps/web/src/lib/uuid.ts`).
- **November 8, 00:08, `887d4f7`:** busy overlays stop blocking controls; interleaved prefetch deduplicates; Retry waits for the old session's DELETE (`apps/web/src/player/PlayerOverlays.module.css`, `apps/web/src/player/sessionApi.ts`).
- **00:14, `9a9a0df`:** errored sessions no longer count as active, and late activity snapshots cannot resurrect ended sessions (`apps/desktop/src/monitor.ts`).
- **00:27, `989dbcc`:** release automation skips a commit already contained by a newer release tag (`scripts/next-version.mjs`). This is a guard, not evidence of a particular release publication.

Health has a traceable sequence: **November 7, 19:22, `2da75a6`**, stops polling while SSE is live; `704c406` adds open-time reconciliation; **November 8, 00:42, `5eefa37`**, routes snapshots through the shared query and cancels older work so the newest answer wins (`apps/web/src/events/serverEvents.ts`, `apps/web/src/components/HealthPill.tsx`).

### November 8, 13:57–18:16: richer details, local preferences, and wiki automation

- **13:57, `5e373b4`:** the server adds cast/similar arrays to details and filters virtual/link-local adapters when physical candidates exist (`packages/shared/src/catalog.ts`, `apps/server/src/tmdb/service.ts`, `apps/server/src/tmdb/normalize.ts`, `apps/server/src/net.ts`). mDNS advertises the same address list (`apps/server/src/discovery.ts`). If filtering removes every candidate, the non-internal IPv4 list is retained.
- **14:21, `70da9c6`:** one always-visible navigation search field replaces the search page's separate field; a single Dashboard link replaces individual dashboard nav links. URL query/history, debounce, and desktop shortcuts are coordinated (`apps/web/src/components/NavSearch.tsx`, `apps/web/src/components/useNavSearch.ts`, `apps/web/src/lib/searchUrl.ts`).
- **14:38, `73a8cf3`:** cast and “More like this” rows reach movie/show details; empty rows are omitted (`apps/web/src/components/DetailsExtras.tsx`, `apps/web/src/components/CastRow.tsx`).
- **14:56, `f7439ab`:** unfinished episodes hide descriptions and use low-resolution stills by default. The preference is browser-local, with page-lifetime fallback when storage is blocked (`apps/web/src/lib/spoilers.ts`, `apps/web/src/components/EpisodeRow.tsx`, `apps/web/src/components/ContinueWatchingRow.tsx`).
- **15:19, `537573d`:** the mini player gains volume/mute controls. Handoff already carried those values; the visible controls are new (`apps/web/src/desktop/MiniVolume.tsx`, `apps/web/src/desktop/MiniControls.tsx`).
- **15:38, `fcb4a00`:** accessible Settings/About tabs separate device/desktop controls from read-only information (`apps/web/src/pages/SettingsPage.tsx`, `apps/web/src/pages/settings/SettingsTabs.tsx`, `apps/web/src/pages/settings/AboutPanel.tsx`). `docs/ideas.md` and `docs/ideas/settings-sidebar-mockup.html` are proposals, not an implemented sidebar.
- **18:16, `0a8f04f`:** wiki publishing posts the push summary for a wiki merge made with the built-in token, which does not trigger the review workflow. The publish job waits for the merge and calls the existing script without the AI key for the wiki-only summary (`.github/workflows/droid-wiki-refresh.yml`, `scripts/droid-push-review.mjs`, `docs/ci.md`).

Interleaved test corrections (`4e5425d`, `501f40a`, `c01ed4a`, `b75820a`) refine result scoping, expected progress responses, image-base fixtures, and the spoiler-switch write assertion. They are not separate feature introductions.

At the measured commit, the browser player and desktop shell are implemented. Dashboard content still uses `apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`; TV remains planned with no workspace. See [web](apps/web/index.md) and [desktop](apps/desktop/index.md).

## Longest-standing live features

“Later changes” counts subsequent reachable commits touching the evidence path after its first introduction. Directory scopes are recursive; formatting counts. These are path-history counts, not semantic rewrite counts.

| Surviving feature      | Introduced, UTC+11          | Later changes | Current evidence scope              |
| ---------------------- | --------------------------- | ------------: | ----------------------------------- |
| mDNS discovery         | 2026-11-05 10:51, `c0781bd` |             1 | `apps/server/src/discovery.ts`      |
| Device registration    | 2026-11-05 10:51, `c0781bd` |             0 | `apps/server/src/routes/devices.ts` |
| Shared base contracts  | 2026-11-05 10:51, `c0781bd` |             4 | `packages/shared/src/schemas.ts`    |
| SQLite migration chain | 2026-11-05 10:51, `c0781bd` |             3 | `apps/server/src/db/migrations.ts`  |
| Service composition    | 2026-11-05 10:51, `c0781bd` |            17 | `apps/server/src/app.ts`            |
| TMDB catalog           | 2026-11-05 10:58, `da8062d` |             7 | `apps/server/src/tmdb`              |
| Parsing/ranking        | 2026-11-05 11:14, `73227ca` |             7 | `apps/server/src/streams`           |
| Playback pipeline      | 2026-11-05 11:51, `64b2054` |            36 | `apps/server/src/playback`          |
| Shared source cache    | 2026-11-05 15:26, `88ffb52` |            16 | `apps/server/src/sourceproxy`       |
| Prefetch               | 2026-11-05 15:26, `88ffb52` |             4 | `apps/server/src/prefetch`          |

Device registration survives untouched at its original path. Discovery was updated on November 8 to share the filtered LAN list. Playback's surviving directory does not imply unchanged internals.

## Replacements and major rewrites

| Former behavior                                     | Replacement date / commit | Evidence                                                                        |
| --------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------- |
| Direct upstream probe/encoder inputs from `64b2054` | 2026-11-05, `88ffb52`     | Loopback range cache, `apps/server/src/sourceproxy/proxy.ts`                    |
| Direct video media-playlist entry                   | 2026-11-05, `e257e71`     | Master/media/subtitle playlists, `apps/server/src/playback/playlist.ts`         |
| Remux-first ranking from `73227ca`                  | 2026-11-06, `24250c7`     | WEB-DL-first ordering, `apps/server/src/streams/rank.ts`                        |
| Mixed unit/route integration layout                 | 2026-11-06, `a402734`     | Four explicit tiers, `apps/server/vitest.config.ts`                             |
| Browser placeholder from `c0781bd`                  | 2026-11-07, `b5c71c9`     | Routed UI, `apps/web/src/App.tsx`                                               |
| Monolithic playback manager                         | 2026-11-07, `2d60a28`     | Facade and focused modules, `apps/server/src/playback/manager.ts`               |
| Immediate discard force-kill from `bd131f1`         | 2026-11-07, `1ba655d`     | Input cut plus bounded graceful stop, `apps/server/src/playback/discardStop.ts` |
| Browser player placeholder                          | 2026-11-07, `72b7322`     | HLS player, `apps/web/src/player/Playback.tsx`                                  |
| Desktop support-only workspace from `f252d00`       | 2026-11-07, `890e841`     | Running shell, `apps/desktop/src/main.ts`                                       |
| Separate search-page input / dashboard nav links    | 2026-11-08, `70da9c6`     | Shared nav search, `apps/web/src/components/Nav.tsx`                            |
| Single Settings content view                        | 2026-11-08, `fcb4a00`     | Settings/About tabs, `apps/web/src/pages/SettingsPage.tsx`                      |

The manager split is a genuine decomposition with a surviving facade. Browser-player and desktop-shell changes add capabilities rather than replace earlier full applications. The **November 6 formatting commit `bacce15`** is not an architectural rewrite; the test-tier split moves many paths rather than abandoning tests. No language/server-stack migration or retired TV implementation is established by this history.

## Growth trajectory

Each checkpoint reads its own committed tree using the [statistics exclusions and classification](by-the-numbers.md#measurement-scope). Totals include tests, configuration, documentation, comments, and blanks; source uses the ordered source class.

| Checkpoint, UTC+11                      | Commit    | Text files | Total physical lines | Source physical lines | Workspaces |
| --------------------------------------- | --------- | ---------: | -------------------: | --------------------: | ---------: |
| 2026-11-05 10:51, foundation            | `c0781bd` |         51 |                2,151 |                 1,054 |          3 |
| 2026-11-05 15:26, proxy/prefetch        | `88ffb52` |        129 |               12,722 |                 6,516 |          3 |
| 2026-11-06 18:00, test tiers            | `a402734` |        277 |               33,221 |                14,796 |          3 |
| 2026-11-06 20:03, observability         | `e62008d` |        374 |               42,949 |                18,388 |          3 |
| 2026-11-07 03:00, desktop support       | `f252d00` |        466 |               51,363 |                20,825 |          4 |
| 2026-11-07 05:15, routed UI             | `b5c71c9` |        550 |               58,157 |                25,211 |          4 |
| 2026-11-07 14:40, manager split         | `2d60a28` |        575 |               60,648 |                26,035 |          4 |
| 2026-11-07 19:58, browser player        | `72b7322` |        657 |               71,707 |                30,437 |          4 |
| 2026-11-07 21:16, Electron shell        | `890e841` |        730 |               79,856 |                35,293 |          4 |
| 2026-11-08 00:42, health reconciliation | `5eefa37` |        761 |               84,651 |                37,168 |          4 |
| 2026-11-08 18:16, measured commit       | `0a8f04f` |        799 |               89,742 |                38,097 |          4 |

The original three workspaces begin November 5. Desktop support adds the fourth November 7, and a running shell follows that evening. At the measured commit, **43,758 test/support lines exceed 38,097 source lines**; growth is not product code alone. No person-level metrics or contributor rankings are inferred.

Reproduce feature introductions/change counts with `git log --reverse --format='%h|%cI|%s' 0a8f04fd81cfaa7ca5d1689550ad207e7fc0d3ae -- <repo-root-path>` and count entries after the first. Dates above use committer time, not author time. Growth reads committed blobs at each checkpoint, not the working tree. No helper files, dependency installs, application tests, live calls, or encoders were needed.
