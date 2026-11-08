# Desktop shell

Active contributors: VeroxAUS

## Purpose

The Electron 45 desktop app is a working single-instance tray shell around the server-hosted [web UI](../web/index.md). It supervises a local server, opens the main and mini-player windows, persists preferences, exposes a restricted preload bridge, and integrates Windows startup, notifications and power management. It does not import web or server implementation modules.

The player and shell are implemented; dashboard tabs remain limited/placeholder views and the Android TV app has no source directory. Shared TV capability contracts do not imply a shipped TV app.

## Layout and key abstractions

| Boundary          | Source                            | Responsibility                                                                 |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| Bootstrap         | `apps/desktop/src/main.ts`        | Single-instance lock, environment, pre-ready settings, telemetry and lifecycle |
| `Shell`           | `apps/desktop/src/shell/shell.ts` | Windows, tray, IPC, monitoring and graceful quit composition                   |
| `Supervisor`      | `apps/desktop/src/supervisor.ts`  | Owned child versus external attachment, readiness, retries and shutdown        |
| `ServerMonitor`   | `apps/desktop/src/monitor.ts`     | SSE, activity reconciliation and health                                        |
| `SettingsStore`   | `apps/desktop/src/settings.ts`    | Validated, atomic desktop preferences                                          |
| `MiniPlayerState` | `apps/desktop/src/miniPlayer.ts`  | One-session renderer handoff                                                   |
| `KeepAwake`       | `apps/desktop/src/keepAwake.ts`   | At most one power-save blocker                                                 |

`apps/desktop/src/shell/` contains Electron adapters; sibling source modules hold injectable policy, file and process seams. Telemetry support lives in `apps/desktop/src/telemetry/`; outbound SDK behavior belongs to [telemetry](../../systems/telemetry.md).

## Startup and lifetime

`apps/desktop/src/main.ts` names the app HomeStream and selects the HomeStream user-data directory unless Chromium's user-data override is present. The lock is acquired before startup: another normal launch focuses the main window; another launch with `--quit` asks the existing instance to shut down. `--hidden`, parsed in `apps/desktop/src/cli.ts`, starts directly to the tray.

Desktop preferences and hardware acceleration are read before Electron becomes ready. After readiness, the shell installs permissions, IPC and tray, optionally opens the window, and starts server supervision. Closing every window does not quit the app. All quit requests use one shared shutdown promise: stop monitoring, release power management, destroy mini, stop only the owned server, destroy tray, flush telemetry, destroy main, then exit.

Read [server supervision](supervisor.md) for ownership, crash recovery and activity correctness, and [windows and IPC](windows-and-ipc.md) for renderer trust and handoff.

## Settings and configuration

`apps/desktop/src/settings.ts` recovers missing or malformed fields independently rather than discarding all valid preferences. Defaults come from `packages/shared/src/desktop.ts`: minimized startup, tray close, ready/failure notifications and hardware acceleration enabled; close notice not yet shown.

Updates accept only five renderer-editable keys with the correct value type. The one-time close-notice marker is shell-only. `apps/desktop/src/jsonFile.ts` writes a temporary file and renames it; preferences change in memory and notify listeners only after a successful write. `desktop-settings.json`, `window-state.json` and the random telemetry installation ID are stored under Electron user data.

Windows autostart uses Electron login-item settings, not a JSON preference. Its arguments include `--hidden` only when minimized startup is selected; changing that setting rewrites an already-enabled login item (`apps/desktop/src/shell/shell.ts`). Hardware acceleration is applied on the next process launch.

Renderer settings are now grouped inside the Settings tab, while About shows app/server information. Browser-only spoiler protection is separate from the persisted desktop preference store. Mini-player volume and mute controls also live in the web renderer, not in Electron IPC (`apps/web/src/pages/SettingsPage.tsx`, `apps/web/src/lib/spoilers.ts`, `apps/web/src/desktop/MiniVolume.tsx`). See [desktop integration](../web/desktop-integration.md).

`apps/desktop/src/envFile.ts` resolves an explicit environment-file override first, then packaged `%APPDATA%/HomeStream/config.env`; development prefers the repository `.env`, falling back to the AppData file when appropriate. The shell loads only its port, data and telemetry keys, without overwriting nonblank environment values. The server reads the same file itself.

Opening configuration accepts only a path ending in `.env`. A missing file is created exclusively with empty TMDB, gateway and TorBox key names; an existing file is neither overwritten nor backfilled. Windows opens Notepad, other platforms use the OS opener. This is a manual setup path, not credential submission through IPC. Missing upstream keys lead to the web first-run setup experience, not a nonexistent-shell state.

## Build, validation and modification

`apps/desktop/package.json` points Electron at compiled main-process code. Build compiles shared, emits TypeScript and copies startup HTML/icons using `apps/desktop/scripts/copyAssets.mjs`. Launch through `apps/desktop/scripts/start.mjs`, which checks build/binary prerequisites and clears inherited Node-only Electron mode:

```sh
pnpm build
pnpm --filter @homestream/desktop build
pnpm --filter @homestream/desktop start
pnpm --filter @homestream/desktop test
pnpm --filter @homestream/desktop smoke
```

The Electron binary is downloaded separately; see [getting started](../../overview/getting-started.md). There is a packaged-runtime launch resolver, but the package currently has no installer/package script.

`apps/desktop/vitest.config.ts` runs offline Node tests and excludes main/bootstrap and Electron shell adapters from coverage. Separate `apps/desktop/vitest.smoke.config.ts` runs two real Electron launch scenarios sequentially, not as part of ordinary unit tests. Both require built server/web/desktop, the Electron binary and a desktop session; Windows CI installs the binary and runs them. Neither proves real playback, NVENC/GPU behavior or live upstream availability. See [testing tiers](../../how-to-contribute/testing.md) and [Windows CI](../../deployment.md#ci-and-releases).

### First run versus configured Home

| Scenario   | Source                                        | Server / DevTools ports | Assertions                                                                                                                                                         |
| ---------- | --------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First run  | `apps/desktop/test/smoke/launch.smoke.ts`     | 8616 / 8617             | Exact 20-member bridge, desktop/non-mini markers, spawned-server PID status, tray tooltip, visible window, “Finish setting up,” and persisted `notifyReady: false` |
| Configured | `apps/desktop/test/smoke/configured.smoke.ts` | 8618 / 8619             | Rendered Home with “The Stub Matrix,” desktop marker, a recorded stub TMDB `/trending/movie` request, and empty `/api/activity` sessions                           |

The first-run scenario points at a nonexistent env file rather than developer configuration. The configured scenario writes an isolated env file and pins invented TMDB/gateway values in the process environment so real values cannot override the file; TorBox is blank. It starts the web e2e stub hub as a separate process, not by importing web implementation into the desktop app. `apps/web/e2e/ports.json` assigns TMDB 8604, gateway 8605, Sentry/health 8606 and PostHog 8607. `apps/web/e2e/support/redirect-fetch.mjs`, preloaded through `NODE_OPTIONS`, redirects server TMDB fetches to loopback and rejects other non-loopback fetches. The configured environment also caps downloads at 60 MB/s, but starts no playback session.

`HOME_PROBE` and `isHomeRendered` in `apps/desktop/test/smoke/harness.ts` require **all** of the `hs:home-content` mark, no first-run text, a `Trending Movies` heading and nonempty poster-link text. The mark alone is insufficient: setup, error and other views can set it too. The configured case additionally checks the expected stub title. This is renderer/content readiness, not merely a server answer or a window appearing; browser harness and bundle checks are described in [web build and tests](../web/build-and-tests.md).

### Bounded harness and cleanup

The shared harness creates throw-away user/data/transcode folders under `HOMESTREAM_TEST_ROOT` or the OS temp directory, disables telemetry/mDNS, clears inherited `ELECTRON_RUN_AS_NODE`, and gives the source proxy a random port. Fixed smoke and hub ports mean these runs must not overlap another smoke run or the web browser harness.

| Wait or operation                                           | Configured bound                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Server answer, then matching app page                       | 60 s each                                                                       |
| Stub hub startup / first-run text / configured Home         | 30 s / 30 s / 60 s                                                              |
| `until` polling; individual server/hub and CDP-list fetches | 500 ms polling; 2 s and 3 s fetch timeouts                                      |
| CDP expression evaluation                                   | 10 s by default                                                                 |
| Second-instance launcher / app exit / tracked-process exit  | 30 s / 30 s / 20 s                                                              |
| Smoke defaults                                              | 60 s test, 150 s hook; configured setup overrides to 180 s, quit tests to 120 s |

These are operation budgets, not one hard wall-clock deadline: a probe can consume its own timeout. Both scenarios send a second launch with `--quit` and expect launcher status 0, app exit 0, no answering server and no surviving tracked PIDs. The configured case explicitly adds the server PID parsed from bridge status. The harness records launcher descendants and retains known Electron/helper/server PIDs even after their parent exits.

Fallback `teardownSmoke` runs shell-process cleanup, additional-PID cleanup (the configured stub hub), then temp-folder removal as independent steps. Earlier failure does not skip later steps; process failures are reported together, while a locked folder only warns. `apps/desktop/test/smoke/teardown.ts` gently stops known live PIDs, polls every 250 ms for up to 5 s, then force-kills survivors and waits up to 3 s. Windows uses PID-scoped `taskkill` (forced tree kill for survivors); POSIX uses signals to tracked PIDs, never a process-name kill.

`apps/desktop/test/smokeHarness.test.ts` runs offline with fake processes and a VM DOM/performance facade. It accepts rendered Home but rejects setup, skeletons, error panels, empty posters and missing Trending Movies; checks the actual probe selectors; parses Windows single/multiple JSON rows and POSIX process tables; handles descendant cycles; and covers children surviving the launcher, newly discovered children, gentle/forced stop, kill survivors, locked folders, hub cleanup despite shell failure, and absent/already-gone PIDs. These regressions do not launch Electron or touch real processes. The smoke does not exercise a real mini-player playback handoff; that lifecycle belongs to [windows and IPC](windows-and-ipc.md) and [playback](../../systems/playback/index.md).

Start policy changes in the injectable module, add its unit regression, then change the Electron adapter. Renderer work belongs in [desktop integration](../web/desktop-integration.md); contract changes belong in [shared](../../packages/shared.md).

## Key source files

| File                                          | Purpose                                            |
| --------------------------------------------- | -------------------------------------------------- |
| `apps/desktop/src/main.ts`                    | Executed bootstrap                                 |
| `apps/desktop/src/shell/shell.ts`             | Application composition and shutdown               |
| `apps/desktop/src/settings.ts`                | Field recovery and validated updates               |
| `apps/desktop/src/envFile.ts`                 | Environment resolution and missing-file template   |
| `apps/desktop/src/jsonFile.ts`                | Atomic JSON persistence                            |
| `apps/desktop/src/logger.ts`                  | Injected structured, scrubbed logging              |
| `apps/desktop/src/requestId.ts`               | Request correlation                                |
| `apps/desktop/test/settingsFile.test.ts`      | Preference and write-failure regressions           |
| `apps/desktop/test/launchAndEnv.test.ts`      | Launch/environment/startup-page cases              |
| `apps/desktop/test/smoke/launch.smoke.ts`     | Real-runtime first-run validation                  |
| `apps/desktop/test/smoke/configured.smoke.ts` | Configured Home with local upstream stubs          |
| `apps/desktop/test/smoke/harness.ts`          | Launch, rendered-Home probe, quit and PID tracking |
| `apps/desktop/test/smoke/cdp.ts`              | Bounded DevTools discovery and evaluation          |
| `apps/desktop/test/smoke/teardown.ts`         | Independent cleanup steps and PID stop escalation  |
| `apps/desktop/test/smokeHarness.test.ts`      | Offline readiness/process/cleanup regressions      |

## Measured scope

At `bb09d63`, committed `apps/desktop/src/` has **31 TypeScript source files**, including the `.cts` preload; `apps/desktop/test/` has **19 test files** (17 `.test.ts`, two `.smoke.ts`), plus three excluded helpers: `apps/desktop/test/smoke/cdp.ts`, `apps/desktop/test/smoke/harness.ts` and `apps/desktop/test/smoke/teardown.ts`. Test/source file ratio: **0.61** (19/31, rounded to two decimals). Counts use `git ls-tree -r --name-only HEAD`, classifying source by `.ts`/`.cts` beneath `apps/desktop/src/` and tests by `.test.ts`/`.smoke.ts` beneath `apps/desktop/test/`, excluding configs/assets/build outputs and nonsuite helpers. Scoped `git log origin/main --format='%aN' -- apps/desktop` history has **1 unique human author** after excluding bots, VeroxAUS, matching `.github/CODEOWNERS`. These are inventory counts, not coverage or a claim that tests were run for this documentation.
