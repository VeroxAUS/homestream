# Lore

HomeStream's complete available history contains **51 commits**, from `c0781bd` on **2026-11-05** through `7eb94bafed5e0e046987a81d0cbbff8e6ba999d1` on **2026-11-07**. It records a server build-out followed by the first substantial browser UI, not years of migrations. For today's system, see [architecture](overview/architecture.md); [by the numbers](by-the-numbers.md) defines the measurements used below.

Collected on **2026-11-06 at 22:00 UTC**. Historical dates below use **committer timestamps normalized to UTC+11**. Thus HEAD's recorded **2026-11-07 05:57:34 +11:00** is **2026-11-06 18:57:34 UTC**. The apparent discrepancy with the supplied November 6 date is a timezone difference; the November 7 git timestamps are preserved.

Commit subjects/bodies and diffs support the events below. They do not establish private prehistory, release publication times, or undocumented motivations.

## Eras

These seven phases fit inside roughly 43 hours of recorded development. “Era” describes a change in focus, not a long-lived organizational period.

### 2026-11-05, 10:51–11:14: foundation and discovery

The root commit, `c0781bd` at **10:51**, adds the pnpm monorepo, Fastify server, built-in SQLite persistence, device registration, events, mDNS, and a minimal React 19/Vite placeholder. Three workspaces exist immediately: `apps/server/package.json`, `apps/web/package.json`, and `packages/shared/package.json`.

- **10:58, `da8062d`:** TMDB metadata and catalog routes arrive, with SQLite caching in `apps/server/src/tmdb/service.ts` and `apps/server/src/tmdb/cache.ts`.
- **11:14, `73227ca`:** gateway discovery, parsing, and ranking arrive in `apps/server/src/gateway/client.ts`, `apps/server/src/streams/parse.ts`, and `apps/server/src/streams/rank.ts`.

The initial browser page is scaffolding, not a former complete player. The server/shared split remains in place at HEAD. See [catalog](features/catalog.md).

### 2026-11-05, 11:51–17:32: playback becomes a managed pipeline

At **11:51**, `64b2054` introduces session management, probe-driven decisions, FFmpeg HLS encoding, segment delivery, and play records. Current descendants include `apps/server/src/playback/manager.ts`, `apps/server/src/playback/decision.ts`, `apps/server/src/playback/ffmpegArgs.ts`, and `apps/server/src/db/plays.ts`.

- **12:44, `c67be3b`:** seek restarts, lifecycle handling, encoder statistics, and a disk cap extend the session core. Current anchors include `apps/server/src/playback/monitor.ts`, `apps/server/src/playback/pidRegistry.ts`, and `apps/server/src/playback/diskCap.ts`.
- **13:35, `f2e90f9`:** audio/subtitle track selection, WebVTT extraction, and bitmap burn-in arrive in `apps/server/src/playback/tracks.ts` and `apps/server/src/playback/subtitleExtractor.ts`.
- **15:26, `88ffb52`:** FFprobe/FFmpeg inputs move behind a shared loopback range cache. Prefetch warms the recommended source and reuses probes through `apps/server/src/sourceproxy/proxy.ts`, `apps/server/src/sourceproxy/sourceEntry.ts`, and `apps/server/src/prefetch/service.ts`.
- **17:32, `e257e71`:** progressive WebVTT changes the HLS entry from a media playlist to a master playlist with separate video/subtitle renditions, implemented in `apps/server/src/playback/playlist.ts` and `apps/server/src/playback/subtitleStore.ts`.

The last commit gives a concrete reason for its coverage clock: FFmpeg's output time follows sparse subtitle output, so extraction coverage instead uses a video-copy packet listing (`apps/server/src/playback/subtitleRun.ts`). The history supports this rationale, not an independently measured performance improvement. See [playback](systems/playback/index.md) and [source proxy](systems/source-proxy.md).

### 2026-11-05 18:45–2026-11-06 13:25: resource budgets

This phase constrains encoders and upstream reads without replacing the media engine.

- **November 5, 18:45, `951af22`:** a GPU health gate and sequential encode project arrive in `scripts/gpu-health.mjs` and `apps/server/vitest.config.ts`.
- **November 5, 19:23, `c9284e5`:** the kept-HDR 2160p bitmap-subtitle path gains NVDEC support in `apps/server/src/playback/ffmpegArgs.ts`. Resource defaults follow at **19:49, `063ed2b`**, in `apps/server/src/config.ts`.
- **November 6, 01:13, `f6cb61d`:** the per-process FFmpeg memory watchdog arrives in `apps/server/src/playback/memoryWatchdog.ts`. At **01:29, `f193d20`**, subtitle resampling changes `apps/server/src/playback/ffmpegArgs.ts` to bound burn-in memory.
- **November 6, 12:13, `0e4da32`:** subtitle extractors are paced against encoder progress in `apps/server/src/playback/extractorSchedule.ts`.
- **November 6, 13:18, `963572e`:** a shared download cap and read-ahead window arrive in `apps/server/src/network/downloadGate.ts` and `apps/server/src/network/readAhead.ts`.
- **November 6, 13:25, `7be7179`:** the playback manager limits concurrent sessions to two (`apps/server/src/playback/manager.ts`).

No GPU run or before/after timing measurement was performed for this wiki. See [network controls](systems/network.md) for current behavior.

### 2026-11-06, 13:56–17:34: automatic recovery and persistent state

The server gains behavior around playback startup and between viewing sessions.

- **13:56–13:58, `5a4e9ab` and `cb96b13`:** a generated wiki and scheduled refresh workflow enter the repository. The maintained automation description is `docs/wiki.md`; the workflow is `.github/workflows/droid-wiki-refresh.yml`.
- **14:19, `24250c7`:** WEB-DL-first ranking replaces remux-first preference within a resolution tier. Gateway placeholder detection and automatic cached-source fallback extend `apps/server/src/streams/rank.ts`, `apps/server/src/playback/resolveUrl.ts`, and `apps/server/src/playback/manager.ts`.
- **14:28, `b96f896`:** server-selected default subtitles arrive in `apps/server/src/playback/defaultSubtitle.ts`.
- **14:51, `e906f95`:** progress, continue watching, history, statistics, and the home banner add persistent viewing behavior through `apps/server/src/progress/service.ts`, `apps/server/src/stats/aggregate.ts`, and `apps/server/src/home/service.ts`.
- **15:15, `20d1ce2`:** health checks, log access, and SSE health snapshots arrive in `apps/server/src/health/service.ts`, `apps/server/src/routes/health.ts`, and `apps/server/src/routes/events.ts`.
- **15:37, `4336e69`:** TorBox caching tracks titles without a usable cached stream in `apps/server/src/downloads/service.ts` and `apps/server/src/downloads/store.ts`.
- **17:34, `1e66f31`:** the download gate retains low-lead state across request gaps, shutdown becomes bounded, and playback startup timings become visible (`apps/server/src/network/downloadGate.ts`, `apps/server/src/shutdown.ts`, `apps/server/src/playback/startTimeline.ts`).

The shutdown commit identifies an open event-stream response blocking closure. That is recorded failure evidence, rather than a guessed reason for the refactor. See [downloads](features/downloads.md) and [viewing progress](features/viewing-progress.md).

### 2026-11-06, 17:54–22:08: quality gates and operations

The evening adds repository tooling, test separation, monitoring, and security checks.

- **17:54, `48e1108`, and 17:55, `bacce15`:** quality configurations and hooks arrive, followed by repository-wide formatting (`eslint.config.mjs`, `lefthook.yml`, `scripts/install-hooks.mjs`).
- **18:00, `a402734`:** unit, integration, GPU, and live test tiers replace the mixed test layout, with coverage thresholds and CI reporters (`apps/server/vitest.config.ts`, `apps/server/coverage-thresholds.json`, `scripts/vitest-flaky-reporter.mjs`).
- **18:43, `753f30f`:** maintained documentation, runbooks, API export tooling, and agent instructions expand `docs/`, `AGENTS.md`, and `scripts/check-docs.mjs`.
- **20:03, `e62008d`:** request IDs, metrics, operational probes, optional telemetry, flags, and alert rules arrive (`apps/server/src/http/observability.ts`, `apps/server/src/routes/ops.ts`, `apps/server/src/telemetry/index.ts`, `packages/shared/src/analytics.ts`, `monitoring/prometheus/alerts.yml`).
- **20:52, `24f815e`:** CI/release automation and readiness auditing arrive in `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and `scripts/readiness-audit.mjs`.
- **21:12–21:22, `b7b16c3`, `bd42b67`, and `dae39f0`:** Linux portability, worker sizing, and environment-sensitive bandwidth assertions are adjusted (`vitest.shared.ts`, `apps/server/test/sourceproxy/bandwidthCap.test.ts`).
- **21:55, `9ef0c98`, and 22:08, `bb48e6d`:** CodeQL scanning and security/dependency fixes tighten `.github/workflows/codeql.yml`, `packages/shared/src/sanitize.ts`, `scripts/check-docs.mjs`, `apps/server/src/routes/ops.ts`, and `pnpm-workspace.yaml`.

This phase ends at the previous wiki's recorded source baseline, `bb48e6d`, not at today's HEAD. See [tooling](how-to-contribute/tooling.md) and [security](security.md).

### 2026-11-06 22:49–2026-11-07 01:25: readiness and privacy corrections

The next commits repair the new automation and clarify telemetry's privacy boundary.

- **November 6, 22:49, `2a4591b`:** upstream task dependencies, scanning, flags, telemetry smoke/alert tooling, and wiki publishing receive readiness fixes (`turbo.json`, `scripts/pre-commit-secrets.mjs`, `scripts/flags.mjs`, `scripts/sentry-alerts.mjs`, `scripts/wiki-mirror.mjs`).
- **November 7, 00:03, `fbe2ed2`:** agent-guide fences, API error documentation, diagram drift checks, and repository-secret documentation are corrected (`AGENTS.md`, `apps/server/src/docs/openapi.ts`, `scripts/check-docs.mjs`, `.env.example`).
- **November 7, 00:39, `9fe4d6e`:** telemetry sanitization and documentation address ingestion IP/geo inference, and disabled flag reads retain source logging (`packages/shared/src/sanitize.ts`, `apps/server/src/telemetry/index.ts`, `docs/PRIVACY.md`).
- **November 7, 01:25, `c4e3293`:** the sanitizer starts supplying an empty `user.geo` because the prior inference setting alone did not stop the described Sentry Relay geo lookup (`packages/shared/src/sanitize.ts`).

These are successive corrections, not evidence that an earlier privacy mechanism was complete. The wiki does not verify upstream account settings or ingestion behavior against live services. See [telemetry](systems/telemetry.md).

### 2026-11-07, 03:00–05:57: client foundations become a browser application

At **03:00**, `f252d00` adds the fourth workspace, `apps/desktop/package.json`, and browser/desktop request IDs, logging, telemetry support, tests, and bundle budgets. Random installation identity arrives in `packages/shared/src/identity.ts`. The desktop entry at `apps/desktop/src/index.ts` exports support modules; it does not start a BrowserWindow, tray, preload, or server supervisor.

- **03:13, `592cb10`:** Playwright configuration can load without an already-built server (`apps/web/playwright.config.ts`).
- **05:15, `b5c71c9`:** a real React route tree replaces the browser placeholder: Home, search, movie/show details, Settings, device registration, download SSE invalidation, and desktop-oriented navigation (`apps/web/src/App.tsx`, `apps/web/src/api/queries.ts`, `apps/web/src/device/identity.ts`, `apps/web/src/events/serverEvents.ts`, `apps/web/src/components/Nav.tsx`). The server gains episode progress lookup and static asset caching (`apps/server/src/routes/progress.ts`, `apps/server/src/routes/static.ts`).
- **05:57, `7eb94ba`:** heavy-source extractor burst timing starts after encoder warm-up rather than at run start (`apps/server/src/playback/extractorSchedule.ts`, `apps/server/src/playback/subtitleExtractor.ts`, `apps/server/src/playback/manager.ts`).

The final commit explains a concrete timing defect: a roughly 20–25-second warm-up consumed a 25-second burst window before useful bursting began. This is commit-recorded rationale, not a benchmark run by the wiki generator.

The browser player and dashboard tabs remain placeholders (`apps/web/src/pages/PlayerPage.tsx`, `apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`). TV remains planned, with no workspace. See [web](apps/web/index.md) and [desktop](apps/desktop.md) for the implemented boundaries.

## Longest-standing features

“Later changes” counts later reachable commits touching the listed file or directory, excluding its first introducing commit. Formatting counts; directory rows include changes anywhere below that directory. These are feature/path-history counts, not individual metrics or semantic rewrite counts.

| Surviving feature      | Introduced, UTC+11          | Later changes through HEAD | Evidence scope                      |
| ---------------------- | --------------------------- | -------------------------: | ----------------------------------- |
| mDNS discovery         | 2026-11-05 10:51, `c0781bd` |                          0 | `apps/server/src/discovery.ts`      |
| Device registration    | 2026-11-05 10:51, `c0781bd` |                          0 | `apps/server/src/routes/devices.ts` |
| Shared base contracts  | 2026-11-05 10:51, `c0781bd` |                          3 | `packages/shared/src/schemas.ts`    |
| SQLite migration chain | 2026-11-05 10:51, `c0781bd` |                          3 | `apps/server/src/db/migrations.ts`  |
| Service composition    | 2026-11-05 10:51, `c0781bd` |                         17 | `apps/server/src/app.ts`            |
| TMDB catalog           | 2026-11-05 10:58, `da8062d` |                          6 | `apps/server/src/tmdb`              |
| Parsing/ranking        | 2026-11-05 11:14, `73227ca` |                          5 | `apps/server/src/streams`           |
| Playback pipeline      | 2026-11-05 11:51, `64b2054` |                         22 | `apps/server/src/playback`          |
| Shared source cache    | 2026-11-05 15:26, `88ffb52` |                          9 | `apps/server/src/sourceproxy`       |
| Prefetch               | 2026-11-05 15:26, `88ffb52` |                          3 | `apps/server/src/prefetch`          |

Discovery and device registration survive untouched at their original paths; playback has continued to change through the latest commit. Survival of a path does not imply unchanged implementation throughout the subsystem.

## Replaced and removed behavior

No whole server-stack or programming-language replacement is verified. The recorded replacements are narrower:

| Former behavior                                              | Introduced                              | Replaced              | Replacement and current evidence                                                              |
| ------------------------------------------------------------ | --------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| Direct encoder/probe upstream input without the shared cache | 2026-11-05, `64b2054`                   | 2026-11-05, `88ffb52` | Loopback range caching and shared probes, `apps/server/src/sourceproxy/proxy.ts`              |
| HLS entry directly describes video segments                  | 2026-11-05, `64b2054`                   | 2026-11-05, `e257e71` | Master entry plus separate media/subtitle playlists, `apps/server/src/playback/playlist.ts`   |
| Remux-first preference within a resolution tier              | 2026-11-05, `73227ca`                   | 2026-11-06, `24250c7` | WEB-DL-first ordering, `apps/server/src/streams/rank.ts`                                      |
| Mixed unit/route integration test layout                     | 2026-11-05 onward                       | 2026-11-06, `a402734` | Separate offline/integration/GPU/live projects, `apps/server/vitest.config.ts`                |
| Minimal browser placeholder                                  | 2026-11-05, `c0781bd`                   | 2026-11-07, `b5c71c9` | Real routes and catalog/settings screens, `apps/web/src/App.tsx`                              |
| Heavy-source burst clock starts before warm-up ends          | Pacing introduced 2026-11-06, `0e4da32` | 2026-11-07, `7eb94ba` | Burst clock deferred until warm-up completes, `apps/server/src/playback/extractorSchedule.ts` |

Test files removed from their former locations in `a402734` were largely moved, not abandoned. Unused exports removed in the same commit are not proof their underlying features were deleted. No verified history of a complete retired desktop or TV app exists. Where commit evidence does not explain a replacement's motivation, this page does not invent one.

## Major rewrites and large changes

Churn uses the [statistics exclusions](by-the-numbers.md#measurement-scope), numeric added/deleted lines, and disabled rename detection. These are large change sets, not all architectural rewrites.

| Date, UTC+11     | Commit    | Paths with numeric churn | Added | Deleted | What changed                                                       |
| ---------------- | --------- | -----------------------: | ----: | ------: | ------------------------------------------------------------------ |
| 2026-11-06 18:00 | `a402734` |                      113 | 5,623 |   5,198 | Test-tier moves, coverage/reporting, unused-export cleanup         |
| 2026-11-06 17:55 | `bacce15` |                      171 | 5,371 |   1,828 | Repository-wide formatting                                         |
| 2026-11-07 05:15 | `b5c71c9` |                      114 | 6,919 |     129 | Browser placeholder replaced by routed UI; small server extensions |
| 2026-11-06 20:03 | `e62008d` |                       79 | 5,440 |      42 | Observability, optional telemetry, flags, and alerts               |
| 2026-11-06 18:43 | `753f30f` |                       56 | 4,329 |      10 | Documentation and developer/API tooling                            |
| 2026-11-06 20:52 | `24f815e` |                       38 | 4,146 |      16 | CI/release/readiness automation                                    |
| 2026-11-07 03:00 | `f252d00` |                       81 | 3,223 |     103 | Browser/desktop readiness and support modules                      |

The **November 7 browser replacement** is the clearest user-facing rewrite. The much larger **November 6 test churn** mostly reorganizes existing tests; rename-aware inspection shows the moves. The **November 6 formatting pass** changes many lines without replacing the server design. `apps/server/src/playback/manager.ts` spans the original playback commit and HEAD.

## Growth trajectory

These checkpoints apply the same committed UTF-8 text inventory rules as the statistics page. Physical lines include source, tests, comments, blanks, configuration, documentation, and licenses. Generated wiki/API/schema outputs, dependencies, and lockfiles are excluded.

| Checkpoint, UTC+11                          | Commit    | Included text files | Physical lines | Workspaces |
| ------------------------------------------- | --------- | ------------------: | -------------: | ---------: |
| 2026-11-05 10:51, foundation                | `c0781bd` |                  51 |          2,151 |          3 |
| 2026-11-05 15:26, proxy/prefetch            | `88ffb52` |                 129 |         12,722 |          3 |
| 2026-11-05 19:59, resource controls         | `dd8dff1` |                 145 |         15,214 |          3 |
| 2026-11-06 17:34, viewing/download state    | `1e66f31` |                 245 |         28,226 |          3 |
| 2026-11-06 18:00, test tiers                | `a402734` |                 277 |         33,221 |          3 |
| 2026-11-06 20:03, observability             | `e62008d` |                 374 |         42,949 |          3 |
| 2026-11-06 22:08, prior wiki baseline       | `bb48e6d` |                 406 |         47,398 |          3 |
| 2026-11-07 03:00, desktop support workspace | `f252d00` |                 466 |         51,363 |          4 |
| 2026-11-07 05:15, real browser UI           | `b5c71c9` |                 550 |         58,157 |          4 |
| 2026-11-07 05:57, current HEAD              | `7eb94ba` |                 550 |         58,241 |          4 |

The server, browser, and shared packages all begin on **November 5**. Desktop support adds a workspace on **November 7**, but not another functioning runtime shell. Much of the growth comes from tests, tooling, and docs as well as product code. The available history does not establish team expansion; no per-person activity comparison is needed to explain the architecture.

As observed on **2026-11-06 UTC**, lightweight tags range from `v0.1.0` through `v0.2.0`. Their target commits include **November 6** fixes and **November 7** client-readiness work; `v0.2.0` points to `592cb10`, before the full browser-screen commit. Lightweight tags have no independent tagger timestamp, and version labels alone do not prove which UI features were released.

To reproduce path introductions and subsequent-change counts, run `git log --reverse --format='%h %cI %s' HEAD -- <repo-root-path>` and count all entries after the first. Growth reads each checkpoint tree, not the current working directory. No tests, live upstreams, or encoders were run to construct this narrative.
