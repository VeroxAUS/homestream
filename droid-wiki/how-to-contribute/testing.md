# Testing

Vitest separates offline unit/integration coverage from real encodes and upstream calls. The safe all-workspace default is `pnpm test:ci`, not `pnpm test` (`package.json`, `apps/server/vitest.config.ts`).

## Choose a tier

| Tier        | Root command            | Server scope                                                  | Requirements                                  |
| ----------- | ----------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| Unit        | `pnpm test:unit`        | `apps/server/test/**/*.test.ts`, excluding the other projects | No external services, GPU or keys             |
| Integration | `pnpm test:integration` | `apps/server/test/integration/`                               | Fastify injection, local stubs, fake encoders |
| GPU         | `pnpm test:gpu`         | `apps/server/test/encode/`                                    | FFmpeg/ffprobe, NVENC and NVIDIA driver       |
| Live        | `pnpm test:live`        | `apps/server/test/live/`                                      | Real TMDB/gateway configuration and network   |

The root unit/integration commands select the server only. `pnpm test:ci` uses Turbo to run server unit + integration, web, desktop and shared tests. `pnpm test:coverage` runs package coverage sequentially and excludes the server GPU/live projects. Plain server `vitest run`, and therefore root `pnpm test`, selects all four server projects (`apps/server/package.json`, `turbo.json`). Offline means no real upstream services: local HTTP stubs are allowed.

```powershell
pnpm test:ci
pnpm test:coverage
pnpm --filter @homestream/server exec vitest run --project unit test/net.test.ts
pnpm --filter @homestream/server exec vitest run --project integration test/integration/progress-routes.test.ts
pnpm --filter @homestream/shared test
```

| Workspace | Test configuration                 | Test location and runtime                                                                |
| --------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| Server    | `apps/server/vitest.config.ts`     | `apps/server/test/`, four named Node projects                                            |
| Web       | `apps/web/vite.config.ts`          | Colocated `apps/web/src/**/*.test.ts(x)`, jsdom and Testing Library                      |
| Desktop   | `apps/desktop/vitest.config.ts`    | `apps/desktop/test/**/*.test.ts`, including `apps/desktop/test/integration/`, plain Node |
| Shared    | `packages/shared/vitest.config.ts` | `packages/shared/test/**/*.test.ts`, plain Node                                          |

The shared-source alias in `vitest.shared.ts` lets server/web/desktop tests read contracts without a prior shared build. This differs from production Node imports, which resolve package exports to built output.

## Isolation and fake seams

`makeTempDir`, `testConfig` and `startTestApp` in `apps/server/test/helpers.ts` provide a unique directory, invented configuration, port 0 and a silent logger. `HOMESTREAM_TEST_ROOT` overrides the Windows-oriented default; CI and the dev container set it to their temporary storage. On Linux, set it explicitly when running tests locally.

`buildApp` in `apps/server/src/app.ts` accepts database, TMDB/gateway, bus and telemetry instances plus probe/resolver, encoder factory, health command/fetch, clocks, timeouts and resource limits. Use these seams rather than real upstreams in offline tests.

| Helper/example                                           | What it replaces or demonstrates                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/server/test/gateway/stubGateway.ts`                | Loopback HTTP server on port 0 with configurable replies, delays and request capture |
| `apps/server/test/tmdb/fixtures.ts`                      | Fake TMDB responses                                                                  |
| `apps/server/test/playback/fakeEncoder.ts`               | First-segment success, immediate failure or a hung encoder without a subprocess      |
| `apps/server/test/playback/harness.ts`                   | Composed app/stub gateway; real probe/encode by default unless replaced              |
| `apps/server/test/integration/playback-fallback.test.ts` | Injected probe and fake encoders; validates fallback and absence of residue          |
| `apps/server/test/integration/openapi.test.ts`           | Route documentation and shared contract checks                                       |

Use `app.inject` for handlers. The reusable playback harness alone does **not** imply an offline test: its media-generation helpers start real encoders. Close harnesses/apps in teardown, close caller-owned database/gateway/telemetry resources, await background work, clear global/environment changes, and remove temp directories only after handles close. New tests must not share ports, files or clocks (`AGENTS.md`).

`apps/server/test/telemetryEnv.ts` removes inherited telemetry keys before server tests. Keep fixtures invented even when the production path contains secret-shaped data; never copy a real gateway/CDN response into a test.

## Browser components and desktop support

`mockApi` in `apps/web/src/test/render.tsx` replaces fetch with a method/path reply table, records requests and answers 404 for unlisted routes. `renderWithProviders` supplies a MemoryRouter and a fresh Query client with retries disabled. `apps/web/src/test/setup.ts` cleans up rendered components, restores environment stubs and supplies scrolling; typed fixtures live in `apps/web/src/test/fixtures.ts`.

Tests cover implemented Home/search/details/Settings behavior, navigation, optimistic updates and download states, not just a shell render (`apps/web/src/App.test.tsx`, `apps/web/src/events/events.test.tsx`). Use fake EventSource and deterministic timer/image behavior instead of a real SSE connection. The player/dashboard placeholder tests establish only the current placeholder contract.

Desktop tests exercise logger/request IDs, configuration, scrubbers, Sentry option builders and analytics wiring. `apps/desktop/test/integration/telemetryWiring.test.ts` composes support modules with a mocked PostHog client; it does not start Electron or contact telemetry services. No Electron binary is needed for these tests. There is not yet a window/tray/supervisor/preload integration to test ([desktop](../apps/desktop.md)).

## Built UI with Playwright

The separate browser tier is not part of `pnpm test:ci` or coverage. Build the server and install Chromium before running it:

```powershell
pnpm --filter @homestream/server build
pnpm --filter @homestream/web exec playwright install chromium
pnpm --filter @homestream/web test:e2e
```

Use `PLAYWRIGHT_BROWSERS_PATH` to choose download storage if needed. `apps/web/e2e/build.mjs` requires the server entry to exist and builds two UIs into `apps/web/reports/e2e-dist/`: **plain** has no telemetry keys, while **stub** points Sentry/PostHog at local receivers and enables the deliberate-error trigger. Both explicitly override telemetry inputs so the developer's `.env` cannot leak keys into the builds. `apps/web/playwright.config.ts` stays loadable without a server build; the prerequisite belongs to the build script.

The config starts a stub hub and two real server processes with separate data/transcode directories, nonexistent env-file paths, server telemetry off and random source-proxy ports. `apps/web/e2e/support/hub.mjs` returns stub metadata/artwork, an empty-stream gateway manifest and captured telemetry/flag replies. `apps/web/e2e/support/redirect-fetch.mjs`, preloaded into each server, redirects TMDB fetches to the hub and rejects other non-loopback fetch destinations.

| Port in `apps/web/e2e/ports.json` | Owner                 |
| --------------------------------: | --------------------- |
|                              8602 | Plain server          |
|                              8603 | Stub-telemetry server |
|                              8604 | TMDB stub             |
|                              8605 | Gateway stub          |
|                              8606 | Sentry receiver       |
|                              8607 | PostHog receiver      |

These intentionally fixed harness ports are the exception to ordinary test port 0. Do not run two harnesses or the default profiler concurrently. The plain project runs `apps/web/e2e/smoke.spec.ts`; the telemetry project runs `apps/web/e2e/telemetry.spec.ts`. They check real screens/deep-link reloads/request IDs/device registration and no-key, opt-out, scrubbed-event and flag behavior. Neither starts a playback session or validates media decoding.

Playwright uses one worker, no file parallelism, one retry only in CI, failure screenshots and retained failure traces. Outputs are `apps/web/reports/e2e-results/` and `apps/web/reports/e2e-report/`; CI uploads them on failure. See [web build and tests](../apps/web/build-and-tests.md).

## Coverage and reports

V8 coverage uses package-local thresholds, not just a global percentage:

| Threshold file                             | Lines | Functions | Branches | Statements |
| ------------------------------------------ | ----: | --------: | -------: | ---------: |
| `apps/server/coverage-thresholds.json`     |    87 |        87 |       79 |         85 |
| `packages/shared/coverage-thresholds.json` |    98 |        98 |       98 |         98 |
| `apps/web/coverage-thresholds.json`        |    95 |        98 |       89 |         95 |
| `apps/desktop/coverage-thresholds.json`    |    92 |        83 |       98 |         89 |

These are minimum percentages, not newly measured coverage. `scripts/coverage-ratchet.mjs` measures coverage and can raise thresholds to the floored measured percentage minus two points; it never lowers them. `pnpm coverage:ratchet --check --no-run` reviews existing summaries without writing thresholds or rerunning suites.

Coverage is a V8 execution metric over the configured source includes, not a test-to-code ratio. The tracked test/source physical-line ratio is **1.04:1**, including helpers and fixtures under the explicit inventory rules in [by the numbers](../by-the-numbers.md); that ratio proves neither branch execution nor assertion quality. No fresh coverage run was performed for this wiki.

Known documentation drift: `docs/TECH_DEBT.md` still describes one placeholder web test and baseline thresholds, and an old web Knip exception. Actual component suites, thresholds above and `knip.jsonc` supersede that description; do not reproduce it as current behavior.

`vitest.shared.ts` caps workers at `min(8, availableParallelism())` and sets 20-second test/hook defaults. Under CI, failed cases retry twice and write `reports/<package>/junit.xml`, `reports/<package>/vitest.json` and `reports/<package>/flaky.json`; ordinary local runs do not retry.

```powershell
pnpm test:report
pnpm test:flaky-report
pnpm test:timing
pnpm ci:summary
```

`scripts/test-report.mjs` runs offline package tests in CI mode and merges reports; `--merge-only` reuses reports from a previous run. Coverage summaries live under each package's `coverage/`. Linux CI uploads merged reports and summaries for 14 days (`.github/workflows/ci.yml`). A pass after retry is still a defect to investigate; follow `docs/runbooks/flaky-tests.md`, not a larger retry count.

## GPU and live safety

Follow `.factory/skills/homestream-live-tests/SKILL.md` before real-world verification. Run one file at a time on an idle machine, never alongside a game or another heavy encode:

```powershell
pnpm --filter @homestream/server exec vitest run --project gpu test/encode/hls-encode.test.ts
pnpm --filter @homestream/server exec vitest run --project live test/live/streams.live.test.ts
```

The GPU project disables file parallelism and uses one worker, a 60-second test default and a 180-second hook default (`apps/server/test/gpuGroups.ts`). `apps/server/test/hasNvenc.ts` gates hardware-dependent suites. `apps/server/test/gpuSetup.ts` invokes cleanup after failures, teardown and worker exit; `apps/server/test/gpuCleanup.ts` only enumerates/kills matching direct child FFmpeg/ffprobe processes on Windows and is a no-op elsewhere. This fallback does not replace explicit resource cleanup or gentle session shutdown.

The optional Windows gate in `scripts/gpu-health.mjs` requires `--since <ISO-time>`, fails closed on unreadable GPU/event state, rejects new driver events, temperature above 83°C or less than 4 GiB free RAM by default. `--require-idle` also checks sustained/bursty utilization. It is not an automatic CI prerequisite.

Live TMDB cases skip without `TMDB_READ_TOKEN`; gateway cases skip without both required keys (`apps/server/test/live/tmdb.live.test.ts`, `apps/server/test/live/streams.live.test.ts`). Keep requests few: the gateway allows about five per five seconds. For manual real-title checks, set `MAX_DOWNLOAD_MBPS=60` or lower and never download whole files.

Manual servers use ports 8600–8699; ordinary server tests use port 0, with the fixed Playwright exception above. End test sessions with `DELETE /api/sessions/:id` without body/content-type, then stop owned server processes by PID and verify no FFmpeg remains. Report skipped tiers as skipped, not as playback validation. See [debugging](debugging.md) and [playback](../systems/playback/index.md).
