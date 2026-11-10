# Testing

Vitest separates offline unit/integration checks from real encoding and upstream calls. The safe all-workspace default is `pnpm test:ci`, not `pnpm test` (`package.json`, `apps/server/vitest.config.ts`).

```mermaid
graph TD
  Change["What needs verification?"] --> Logic["Pure logic or HTTP behavior"]
  Change --> UI["Rendered browser behavior"]
  Change --> Shell["Real shell launch"]
  Change --> Real["Encoder or upstream behavior"]
  Logic --> Offline["Vitest offline projects and coverage"]
  UI --> Browser["Playwright with local stubs"]
  Shell --> Smoke["Separate Electron smoke"]
  Real --> OptIn["Opt-in GPU or live tier"]
```

## Test tiers

| Command                                   | Scope                                             | Requirements                                               |
| ----------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm test:unit`                          | Server unit project                               | No real upstream, GPU or keys                              |
| `pnpm test:integration`                   | Server integration project                        | Fastify injection, local stubs, fake encoders              |
| `pnpm test:ci`                            | All four workspaces, server offline projects only | No real upstream or GPU                                    |
| `pnpm test:coverage`                      | Sequential workspace V8 coverage                  | Same offline scope, threshold gates                        |
| `pnpm test:gpu`                           | Server GPU project                                | Real FFmpeg/NVENC and NVIDIA GPU                           |
| `pnpm test:live`                          | Server live project                               | Real configured services and limited network calls         |
| `pnpm --filter @homestream/web test:e2e`  | Built browser UI and isolated server              | Chromium and built server; local stub upstreams            |
| `pnpm --filter @homestream/desktop smoke` | Real Electron launch and shutdown                 | Electron binary, desktop session, built server/web/desktop |

Plain server `vitest run` selects all projects; root `pnpm test` therefore is not a safe substitute for `test:ci` (`apps/server/package.json`, `turbo.json`). Local HTTP stub servers are allowed in offline tests.

CI runs coverage and uploads `test-reports` in **Linux tests**, independently of **Linux checks** and **Linux secrets**. The required **Linux** gate fails unless all three succeed. Software FFmpeg is cached as runner-image-specific packages; a cache failure falls back to bounded apt attempts (`.github/workflows/ci.yml`). The checked-in layout regression in `apps/server/test/scripts/workflows.test.ts` asserts that the parallel jobs remain unconditional and that required commands were not dropped. See [deployment](../deployment.md#ci-and-releases).

```powershell
pnpm --filter @homestream/server exec vitest run --project unit test/net.test.ts
pnpm --filter @homestream/server exec vitest run --project integration test/integration/progress-routes.test.ts
pnpm --filter @homestream/shared test
pnpm --filter @homestream/web test
pnpm --filter @homestream/desktop test
```

Server/shared tests live in their `test` directories; web tests sit beside source and use jsdom/Testing Library; desktop logic runs in Node. Configurations are `apps/server/vitest.config.ts`, `packages/shared/vitest.config.ts`, `apps/web/vite.config.ts`, and `apps/desktop/vitest.config.ts`. `vitest.shared.ts` aliases shared source, caps workers at the smaller of 8 and available CPUs, and gives ordinary tests/hooks 20-second defaults.

## Isolation and fakes

`makeTempDir`, `testConfig`, and `startTestApp` in `apps/server/test/helpers.ts` provide isolated directories, invented settings, and random ports. Set `HOMESTREAM_TEST_ROOT` to writable local storage, especially on non-Windows machines: the fallback is a Windows-oriented path. Close apps and stubs before removing files (`AGENTS.md`).

`buildApp` accepts injected DB, upstream services, telemetry, clocks, probe/resolver, encoder factory, timeouts, and health runners (`apps/server/src/app.ts`). Use `app.inject` for routes. `apps/server/test/playback/fakeEncoder.ts` models success, failure, or stalled processes without encoding. The more general playback harness can start real probes/encoders, so using it alone does not make a test offline (`apps/server/test/playback/harness.ts`).

Web helpers supply fresh Query clients and method/path fetch stubs. Player tests use fake HLS and DOM/media controls, and desktop renderer tests use a typed bridge fake (`apps/web/src/test/render.tsx`, `apps/web/src/test/fakeHls.ts`, `apps/web/src/test/player.tsx`, `apps/web/src/test/desktopBridge.ts`). SSE cases model reconnects and interleaved health answers, not a live telemetry service (`apps/web/src/events/events.test.tsx`).

Desktop unit tests exercise supervision, monitor races, IPC validation, settings, process launch, mini-player state, and telemetry without starting Electron. They also test smoke readiness/process/cleanup helpers with a VM facade and fake processes (`apps/desktop/test/smokeHarness.test.ts`). Cases reject setup, loading, error, missing-heading and empty-poster views; parse Windows/POSIX process tables and descendant cycles; and cover children outliving the launcher, gentle/forced stops, surviving kills, locked folders, missing PIDs and hub cleanup despite shell failure. They do not exercise a real Electron launch or real process teardown.

Recent focused regressions cover a correlated SSE opening line while the connection stays open, with no heartbeat/event duplication (`apps/server/test/integration/events.test.ts`); status-0 HLS fragment retry and subtitle selection after reload (`apps/web/src/player/useHls.test.ts`, `apps/web/src/pages/PlayerSubtitleReload.test.tsx`); and desktop permission scope, bounds round trips and wrong-service startup classification (`apps/desktop/test/permissions.test.ts`, `apps/desktop/test/windowBounds.test.ts`, `apps/desktop/test/supervisor.test.ts`). These checked-in tests are evidence of intended cases, not a claim they ran during this documentation refresh.

## Real Electron smoke

The separate `pnpm --filter @homestream/desktop smoke` command launches the real binary and drives it through CDP; it is not part of offline unit coverage. Windows CI builds server/web/desktop, downloads Electron and runs both scenarios in its required job (`.github/workflows/ci.yml`, `apps/desktop/package.json`). `apps/desktop/vitest.smoke.config.ts` disables file parallelism, defaults to 60-second tests and 150-second hooks; configured setup allows 180 seconds and quit tests allow 120 seconds. See [deployment](../deployment.md#ci-and-releases).

| Scenario                                                  | Ports                                     | Evidence                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| First run, `apps/desktop/test/smoke/launch.smoke.ts`      | Server 8616, DevTools 8617                | Exact 20-member preload bridge, spawned-server status, visible window/tray, setup screen and persisted preference          |
| Configured, `apps/desktop/test/smoke/configured.smoke.ts` | Server 8618, DevTools 8619; hub 8604–8607 | Rendered Home poster rows including “The Stub Matrix,” recorded stub TMDB trending request and no active playback sessions |

Both isolate user/data/transcode directories and disable telemetry/mDNS. Configured launch writes invented keys, pins them in the environment, clears TorBox, and starts `apps/web/e2e/support/hub.mjs`. `apps/web/e2e/ports.json` assigns TMDB/gateway 8604/8605 and Sentry/health/PostHog 8606/8607. The preloaded `apps/web/e2e/support/redirect-fetch.mjs` redirects server TMDB fetches and rejects other non-loopback fetch targets. Do not overlap smoke runs or the browser harness: they share fixed hub ports.

`apps/desktop/test/smoke/harness.ts` allows 60 seconds each for server and matching page, then 30 seconds for first-run text or 60 seconds for configured Home; hub startup gets 30 seconds. Home requires the `hs:home-content` mark **and** no setup text, a Trending Movies heading and nonempty poster text, not just a loaded window or the mark. `until` polls at 500 ms; server/hub probes use 2-second fetch timeouts, CDP discovery 3 seconds and expression evaluation 10 seconds (`apps/desktop/test/smoke/cdp.ts`). Probe duration can extend a polling budget.

Both quit through a second-instance `--quit` launch and assert launcher/app exit 0, no answering server and no surviving tracked children. The launcher, app-exit and process-exit waits are 30/30/20 seconds. Teardown retains known owned PIDs after launcher exit, stops shell survivors and the configured hub independently, then removes the folder even if an earlier step failed. Gentle stop gets 5 seconds, forced stop another 3 seconds with 250-ms polling; process failures are reported, locked-folder removal only warns (`apps/desktop/test/smoke/teardown.ts`). This is PID-scoped cleanup, not process-name killing.

Node coverage excludes `apps/desktop/src/main.ts` and `apps/desktop/src/shell/`; a coverage pass alone does not prove shell launch (`apps/desktop/vitest.config.ts`). Conversely, the smoke proves neither real playback/GPU encoding nor real upstream usability, and does not exercise mini-player playback handoff. See [desktop smoke details](../apps/desktop/index.md#first-run-versus-configured-home), [ownership](../apps/desktop/supervisor.md) and the actual [playback lifecycle](../systems/playback/index.md).

## Browser e2e

```powershell
pnpm --filter @homestream/server build
pnpm --filter @homestream/web exec playwright install chromium
pnpm --filter @homestream/web test:e2e
```

`apps/web/e2e/build.mjs` builds plain and telemetry-stub UIs with explicit key isolation. `apps/web/playwright.config.ts` starts local hub/server processes on 8602–8607, with isolated data, absent private env files, telemetry disabled on servers, and random source-proxy ports. `apps/web/e2e/support/redirect-fetch.mjs` redirects TMDB to local stubs and rejects other non-loopback fetch targets.

The plain project selects nine spec files; the telemetry project selects `apps/web/e2e/telemetry.spec.ts`. The committed scope now includes:

| Area                                                                                 | Source cases                                                                  |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Home, deep links, device registration, no-key telemetry                              | `apps/web/e2e/smoke.spec.ts`                                                  |
| Resume/removal and clickable player overlays                                         | `apps/web/e2e/resume.spec.ts`, `apps/web/e2e/player-input.spec.ts`            |
| Cast/similar API shape, caching, rendering and image loading                         | `apps/web/e2e/details-api.spec.ts`, `apps/web/e2e/details-cast.spec.ts`       |
| Debounce, stale search cancellation, history, shortcuts and responsive navigation    | `apps/web/e2e/nav-search.spec.ts`                                             |
| Browser-local spoiler preference and progress-dependent artwork/descriptions         | `apps/web/e2e/spoilers.spec.ts`                                               |
| Settings/About content, keyboard tabs, hash/history, layout and desktop bridge views | `apps/web/e2e/settings-tabs.spec.ts`, `apps/web/e2e/settings-content.spec.ts` |

No real playback session starts in this suite. Resume and input cases intercept session/media responses in the browser; the hub gateway supplies no playable sources. Browser desktop cases inject a bridge fake, not an Electron runtime (`apps/web/e2e/resume.spec.ts`, `apps/web/e2e/player-input.spec.ts`, `apps/web/e2e/support/hub.mjs`). These are UI/API regressions, not NVENC, native-shell or real upstream validation. See [search](../apps/web/search.md) and [Settings and spoilers](../apps/web/settings-and-spoilers.md).

One Playwright worker prevents harness overlap; do not run two harnesses or a profiler using 8602 together. Failure screenshots and traces go to `apps/web/reports/e2e-results`; the HTML report goes to `apps/web/reports/e2e-report`. See [web checks](../apps/web/build-and-tests.md).

## Coverage and reports

These are configured minimum percentages, not fresh measured coverage:

| Workspace threshold file                   | Lines | Functions | Branches | Statements |
| ------------------------------------------ | ----: | --------: | -------: | ---------: |
| `apps/server/coverage-thresholds.json`     |    87 |        87 |       79 |         85 |
| `packages/shared/coverage-thresholds.json` |    98 |        98 |       98 |         98 |
| `apps/web/coverage-thresholds.json`        |    98 |        99 |       90 |         97 |
| `apps/desktop/coverage-thresholds.json`    |    97 |        91 |       99 |         96 |

`scripts/coverage-ratchet.mjs` measures and can raise thresholds; they may not fall. Its target is the floored measured percentage minus two points, applied only when higher than the existing threshold. `--no-run` reads existing summaries; `--check` writes nothing but can fail when a threshold could rise. File/line ratios in [statistics](../by-the-numbers.md) do not prove coverage or assertion quality.

The shared Vitest configuration retries failing cases twice in CI and writes package JUnit, JSON, and flaky reports under `reports`; local runs do not retry (`vitest.shared.ts`). The separate Electron smoke config does not use that retry/report setup; Playwright retries once in CI (`apps/desktop/vitest.smoke.config.ts`, `apps/web/playwright.config.ts`). `pnpm test:report`, `pnpm test:flaky-report`, `pnpm test:timing`, and `pnpm ci:summary` produce aggregate reports (`scripts/test-report.mjs`, `scripts/flaky-report.mjs`, `scripts/test-timing.mjs`, `scripts/ci-summary.mjs`). Investigate a retry pass through `docs/runbooks/flaky-tests.md`.

## GPU and live safety

Follow `.factory/skills/homestream-live-tests/SKILL.md`. Run one file at a time on an idle machine, never alongside a game. GPU config disables parallel files and caps workers at one (`apps/server/vitest.config.ts`). The Windows health gate fails closed on unreadable temperature/process ownership, new driver events, and unrounded free memory; unrelated FFmpeg does not exempt the idle check (`scripts/gpu-health.mjs`, `scripts/gpu-health-ffmpeg.mjs`).

Keep real-title bandwidth at `MAX_DOWNLOAD_MBPS=60` or lower, make few gateway calls, and never download full files for testing. End sessions gently with bodyless `DELETE /api/sessions/:id`, then stop owned servers by PID. Ordinary server tests use port 0; manually started services use 8600–8699 (`AGENTS.md`). Report skipped tiers honestly. See [debugging](debugging.md) and [playback](../systems/playback/index.md).

This wiki refresh inspected configuration and test sources only; it did not run application, browser, Electron, GPU or live suites.
