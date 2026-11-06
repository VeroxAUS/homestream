# Lore

HomeStream's available history records **41 commits across 2026-11-05 and 2026-11-06**, ending at `bb48e6d9f6c0eb098ae6e3ea29ded95fd991d406`. This is the story of that two-day build-out, not evidence of earlier development. For the current system, start with [architecture](overview/architecture.md) and [features](features/index.md); measurement definitions live in [by the numbers](by-the-numbers.md).

Dates and times below use recorded **committer timestamps in UTC+11**. Commit subjects/bodies establish recorded intent; diffs, surviving source, and blame establish what actually changed. The old wiki's absent baseline commit is not historical evidence for this refresh.

## Eras

These are implementation phases within two days, not multi-year project eras.

### 2026-11-05, 10:51–11:14: foundation and discovery

The first commit, [`c0781bd`](https://github.com/VeroxAUS/homestream/commit/c0781bd), creates the pnpm workspace, Fastify server, SQLite migrations, device registration, events, mDNS, and a minimal React/Vite page. The three present workspace manifests already exist here: `apps/server/package.json`, `apps/web/package.json`, and `packages/shared/package.json`.

- **2026-11-05 10:51:** composition, configuration, persistence, redaction, and discovery begin in `apps/server/src/app.ts`, `apps/server/src/config.ts`, `apps/server/src/db/migrations.ts`, `apps/server/src/redact.ts`, and `apps/server/src/discovery.ts`.
- **2026-11-05 10:58, `da8062d`:** TMDB metadata, SQLite caching, and catalog routes arrive in `apps/server/src/tmdb/service.ts`, `apps/server/src/tmdb/cache.ts`, and `apps/server/src/routes/catalog.ts`.
- **2026-11-05 11:14, `73227ca`:** gateway discovery and stream parsing/ranking arrive in `apps/server/src/gateway/client.ts`, `apps/server/src/streams/parse.ts`, and `apps/server/src/streams/rank.ts`.

The browser page starts as a placeholder and remains one in `apps/web/src/App.tsx`. There is no verified former full web UI or removed desktop application. See [catalog](features/catalog.md) and [stream selection](features/stream-selection.md).

### 2026-11-05, 11:51–17:32: playback becomes a managed pipeline

[`64b2054`](https://github.com/VeroxAUS/homestream/commit/64b2054) introduces sessions, probe-driven decisions, FFmpeg HLS encoding, segment delivery, and play records. The same pipeline remains recognizable in `apps/server/src/playback/manager.ts`, `apps/server/src/playback/decision.ts`, `apps/server/src/playback/ffmpegArgs.ts`, and `apps/server/src/db/plays.ts`.

- **2026-11-05 12:44, `c67be3b`:** seek restarts, monitoring, process recovery, and disk-cap behavior add lifecycle control. Surviving files include `apps/server/src/playback/monitor.ts`, `apps/server/src/playback/pidRegistry.ts`, and `apps/server/src/playback/diskCap.ts`.
- **2026-11-05 13:35, `f2e90f9`:** audio/subtitle selection, WebVTT extraction, and bitmap burn-in arrive in `apps/server/src/playback/tracks.ts` and `apps/server/src/playback/subtitleExtractor.ts`.
- **2026-11-05 15:26, `88ffb52`:** media input moves behind the loopback range cache, probe results become reusable, and prefetch warms a source before Play. The integration survives in `apps/server/src/sourceproxy/proxy.ts`, `apps/server/src/sourceproxy/sourceEntry.ts`, and `apps/server/src/prefetch/service.ts`.
- **2026-11-05 17:32, `e257e71`:** progressive WebVTT changes the HLS entry to a master playlist with a separate video playlist and subtitle renditions, implemented in `apps/server/src/playback/playlist.ts` and `apps/server/src/playback/subtitleStore.ts`.

The subtitle change has a documented technical reason: sparse subtitle output is not a reliable coverage clock. The commit body and `apps/server/src/playback/subtitleRun.ts` use a video-copy packet listing instead. This is verified rationale, not an inferred speedup. See [playback](systems/playback/index.md), [source proxy](systems/source-proxy.md), and [prefetch](features/prefetch.md).

### 2026-11-05 18:45–2026-11-06 13:25: resource budgets

The next phase constrains real encoding and upstream reads rather than introducing another media engine.

- **2026-11-05 18:45, `951af22`:** a GPU health gate and sequential encode test project arrive in `scripts/gpu-health.mjs` and `apps/server/vitest.config.ts`.
- **2026-11-05 19:23, `c9284e5`:** an NVDEC burn-in path for kept-HDR 2160p sources changes `apps/server/src/playback/ffmpegArgs.ts`. Resource defaults follow at **19:49, `063ed2b`**, in `apps/server/src/config.ts`.
- **2026-11-06 01:13, `f6cb61d`:** the per-process FFmpeg memory watchdog arrives in `apps/server/src/playback/memoryWatchdog.ts`. At **01:29, `f193d20`**, bitmap subtitle resampling changes `apps/server/src/playback/ffmpegArgs.ts` to bound burn-in memory.
- **2026-11-06 12:13, `0e4da32`:** subtitle extractors are paced against the encoder, with scheduling logic in `apps/server/src/playback/extractorSchedule.ts`.
- **2026-11-06 13:18, `963572e`:** shared download limiting and read-ahead windows arrive in `apps/server/src/network/downloadGate.ts` and `apps/server/src/network/readAhead.ts`.
- **2026-11-06 13:25, `7be7179`:** the playback manager enforces at most two concurrent sessions in `apps/server/src/playback/manager.ts`.

These commits document resource-control changes. This wiki generation did not run encoders or establish before/after performance numbers. The current details belong in [network controls](systems/network.md) and [playback](systems/playback/index.md).

### 2026-11-06, 14:19–17:34: automatic recovery and persistent viewing state

After the resource work, the server gains behavior around the Play button and between sessions.

- **2026-11-06 14:19, `24250c7`:** source preference changes to WEB-DL-first within a resolution tier, gateway placeholder detection becomes explicit, and automatic startup can try up to three cached candidates. Current anchors are `apps/server/src/streams/rank.ts`, `apps/server/src/playback/resolveUrl.ts`, and `apps/server/src/playback/manager.ts`.
- **2026-11-06 14:28, `b96f896`:** server-selected subtitle defaults arrive in `apps/server/src/playback/defaultSubtitle.ts`.
- **2026-11-06 14:51, `e906f95`:** saved progress, continue watching, history, statistics, and the home banner add persistent viewing behavior. Follow `apps/server/src/progress/service.ts`, `apps/server/src/stats/aggregate.ts`, and `apps/server/src/home/service.ts`.
- **2026-11-06 15:15, `20d1ce2`:** dependency health checks, logs, and SSE health snapshots add an operational view through `apps/server/src/health/service.ts`, `apps/server/src/routes/health.ts`, and `apps/server/src/routes/events.ts`.
- **2026-11-06 15:37, `4336e69`:** TorBox tracking handles titles without a cached stream in `apps/server/src/downloads/service.ts` and `apps/server/src/downloads/store.ts`, backed by migration 3 in `apps/server/src/db/migrations.ts`.
- **2026-11-06 17:34, `1e66f31`:** the download gate remembers low encoder lead across request gaps; shutdown becomes bounded; startup timings become visible. Surviving implementations are `apps/server/src/network/downloadGate.ts`, `apps/server/src/shutdown.ts`, and `apps/server/src/playback/startTimeline.ts`.

The shutdown fix has a concrete failure behind it: the commit body identifies an open event-stream response blocking app closure. See [viewing progress](features/viewing-progress.md), [downloads](features/downloads.md), and [health](systems/health.md).

### 2026-11-06, 17:54–20:52: checks, documentation, and operations

The evening adds repository-wide quality tooling rather than replacing the application.

- **2026-11-06 17:54, `48e1108`, and 17:55, `bacce15`:** quality configuration, hooks, and scripts arrive, then Prettier formats the repository. Current anchors include `eslint.config.mjs`, `lefthook.yml`, and `scripts/install-hooks.mjs`.
- **2026-11-06 18:00, `a402734`:** tests are split into unit, integration, GPU, and live tiers, with coverage thresholds and reporters in `apps/server/vitest.config.ts`, `apps/server/coverage-thresholds.json`, and `scripts/vitest-flaky-reporter.mjs`.
- **2026-11-06 18:43, `753f30f`:** maintained architecture, runbooks, API exports, and agent instructions expand `docs/`, `AGENTS.md`, and `scripts/check-docs.mjs`.
- **2026-11-06 20:03, `e62008d`:** request IDs, metrics, operational probes, optional Sentry/PostHog, feature flags, and alert definitions arrive. Current anchors include `apps/server/src/http/observability.ts`, `apps/server/src/routes/ops.ts`, `apps/server/src/telemetry/index.ts`, `packages/shared/src/analytics.ts`, and `monitoring/prometheus/alerts.yml`.
- **2026-11-06 20:52, `24f815e`:** CI/release automation and readiness tooling extend `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and `scripts/readiness-audit.mjs`.

Generated wiki automation also begins on **2026-11-06 13:56–13:58**, with `5a4e9ab` adding the baseline wiki and `cb96b13` adding `.github/workflows/droid-wiki-refresh.yml` and `docs/wiki.md`. Those generated pages are excluded from the growth measurements below. See [tooling](how-to-contribute/tooling.md) and [monitoring](how-to-monitor/index.md).

### 2026-11-06, 21:12–22:08: portability and security fixes

The final recorded phase tightens the new checks and fixes concrete findings.

- **2026-11-06 21:12, `b7b16c3`:** Linux test/CI portability fixes are followed at **21:17, `bd42b67`**, by worker counts based on available cores in `vitest.shared.ts`.
- **2026-11-06 21:22, `dae39f0`:** bandwidth-cap measurement is limited to environments where loopback buffering permits the assertion, in `apps/server/test/sourceproxy/bandwidthCap.test.ts`.
- **2026-11-06 21:39, `fd39264`:** Sentry organization configuration moves to `SENTRY_ORG`, with an organization placeholder in `monitoring/sentry/alert-rules.json` and environment handling in `scripts/sentry-alerts.mjs`.
- **2026-11-06 21:55, `9ef0c98`:** CodeQL is enabled for the now-public repository through `.github/workflows/codeql.yml`.
- **2026-11-06 22:08, `bb48e6d`:** sanitization removes regex-backtracking risks, the documentation checker strips tags until stable, `/readyz` gains a 300-per-minute rate limit, and dependency overrides address findings. Current evidence is in `packages/shared/src/sanitize.ts`, `scripts/check-docs.mjs`, `apps/server/src/routes/ops.ts`, and `pnpm-workspace.yaml`.

Tags `v0.1.0` and `v0.1.1` point to `dae39f0` and `bb48e6d`. Both targets are dated **2026-11-06**. They are lightweight tags with no separate tagger timestamp, so target commit times are not proof of release publication times. See [security](security.md) and [deployment](deployment.md).

## Longest-standing features

“Later changes” means the number of later reachable commits touching the listed file/directory, excluding its introducing commit. It includes formatting and any change under the directory, not a count of semantic rewrites or every change to the broader feature.

| Surviving feature or foundation | Introduced                  | Later changes | Evidence scope                      |
| ------------------------------- | --------------------------- | ------------: | ----------------------------------- |
| mDNS discovery                  | 2026-11-05 10:51, `c0781bd` |             0 | `apps/server/src/discovery.ts`      |
| Device registration route       | 2026-11-05 10:51, `c0781bd` |             0 | `apps/server/src/routes/devices.ts` |
| Shared base contracts           | 2026-11-05 10:51, `c0781bd` |             3 | `packages/shared/src/schemas.ts`    |
| SQLite migration chain          | 2026-11-05 10:51, `c0781bd` |             3 | `apps/server/src/db/migrations.ts`  |
| Service composition             | 2026-11-05 10:51, `c0781bd` |            17 | `apps/server/src/app.ts`            |
| TMDB catalog                    | 2026-11-05 10:58, `da8062d` |             6 | `apps/server/src/tmdb`              |
| Source parsing/ranking          | 2026-11-05 11:14, `73227ca` |             5 | `apps/server/src/streams`           |
| Playback                        | 2026-11-05 11:51, `64b2054` |            21 | `apps/server/src/playback`          |
| Shared source cache             | 2026-11-05 15:26, `88ffb52` |             9 | `apps/server/src/sourceproxy`       |
| Prefetch                        | 2026-11-05 15:26, `88ffb52` |             3 | `apps/server/src/prefetch`          |

Blame confirms that all **46 lines** of `apps/server/src/discovery.ts` and all **16 lines** of `apps/server/src/routes/devices.ts` still originate in the first commit. In contrast, `apps/server/src/playback/manager.ts` retains **321 lines** attributed to its 2026-11-05 introducing commit amid substantial later additions. Blame is line provenance, not ownership or productivity.

Of the first commit's **52 paths**, **50 remain at the same path**. The other two tests were moved, not abandoned: `apps/server/test/integration/app.test.ts` and `apps/server/test/integration/events.test.ts` replace their former locations directly under the server test directory in `a402734` on **2026-11-06**.

## Deprecated and replaced behavior

No whole user-facing feature removal or application-language rewrite is verified in this short history. The following narrower replacements are supported by diffs and current source.

| Previous behavior                                      | Introduced                     | Replaced                    | Current behavior and evidence                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encoder/probe input without the shared loopback cache  | 2026-11-05 11:51, `64b2054`    | 2026-11-05 15:26, `88ffb52` | The source proxy owns reusable range caching and probe results: `apps/server/src/sourceproxy/proxy.ts`, `apps/server/src/playback/manager.ts`                    |
| HLS entry playlist directly describes video segments   | 2026-11-05 11:51, `64b2054`    | 2026-11-05 17:32, `e257e71` | Entry is a master playlist; separate video and subtitle playlists are produced by `apps/server/src/playback/playlist.ts`                                         |
| Remux-first source preference within a resolution tier | 2026-11-05 11:14, `73227ca`    | 2026-11-06 14:19, `24250c7` | WEB-DL, BluRay, WEBRip, Remux, then HDTV in `apps/server/src/streams/rank.ts`                                                                                    |
| Mixed route/integration tests alongside unit tests     | Built up 2026-11-05–2026-11-06 | 2026-11-06 18:00, `a402734` | Route tests move under `apps/server/test/integration`; real encodes remain under `apps/server/test/encode`, with tiers defined in `apps/server/vitest.config.ts` |

The planned desktop and TV clients (`README.md`) and placeholder browser page (`apps/web/src/App.tsx`) are unfinished scope, not deprecated products. Unused internal exports removed by `a402734` are not evidence that their underlying features were removed.

## Large changes, not a wholesale rewrite

These are the largest commits by additions plus deletions under the [statistics scope](by-the-numbers.md#measurement-scope). Generated wiki, lockfile, and generated API/schema exports are excluded. Rename detection is disabled, so moved files count at both locations.

| Date and time    | Commit    | Paths changed | Added | Deleted | What the evidence supports                                                    |
| ---------------- | --------- | ------------: | ----: | ------: | ----------------------------------------------------------------------------- |
| 2026-11-06 18:00 | `a402734` |           113 | 5,623 |   5,198 | Test-tier reorganization, coverage/reporting, and removal of unused exports   |
| 2026-11-06 17:55 | `bacce15` |           171 | 5,371 |   1,828 | Repository-wide formatting, not replacement of the media architecture         |
| 2026-11-06 20:03 | `e62008d` |            79 | 5,440 |      42 | New observability, telemetry, flags, and alerting surfaces                    |
| 2026-11-06 18:43 | `753f30f` |            56 | 4,329 |      10 | Documentation, bootstrap/checking tools, and API documentation infrastructure |
| 2026-11-06 20:52 | `24f815e` |            38 | 4,146 |      16 | CI/release/readiness automation                                               |

The 2026-11-06 test split is a particularly misleading “rewrite” if judged only by churn. `git show --summary a402734` detects 19 renamed test files, many with 98–100% similarity, while the no-renames churn calculation counts deletion and addition. `apps/server/src/playback/manager.ts` continues across all these phases; there is no verified replacement server stack.

## Growth trajectory

Use the same committed-file inclusion rules at each historical tree, with physical lines including comments, blanks, configuration, documentation, and license. Growth is not all new product code: tooling, formatting, tests, and docs contribute.

| Checkpoint, UTC+11                                               | Commit    | Included files | Physical lines |
| ---------------------------------------------------------------- | --------- | -------------: | -------------: |
| 2026-11-05 10:51, foundation                                     | `c0781bd` |             51 |          2,151 |
| 2026-11-05 15:26, proxy/prefetch                                 | `88ffb52` |            129 |         12,722 |
| 2026-11-05 19:59, end-of-day checkpoint                          | `dd8dff1` |            145 |         15,214 |
| 2026-11-06 17:34, viewing/download features and bounded shutdown | `1e66f31` |            245 |         28,226 |
| 2026-11-06 18:00, test tiers                                     | `a402734` |            277 |         33,221 |
| 2026-11-06 20:03, observability                                  | `e62008d` |            374 |         42,949 |
| 2026-11-06 22:08, current snapshot                               | `bb48e6d` |            406 |         47,398 |

All three present workspaces were added on **2026-11-05**; the expansion is mostly within the server and repository tooling, not an increase in deployed applications. The available history does not establish longer-term growth, team expansion, or private prehistory. For present boundaries and the still-planned clients, return to [architecture](overview/architecture.md).
