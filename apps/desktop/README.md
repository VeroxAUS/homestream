# @homestream/desktop

The Electron 45 desktop shell for HomeStream: a tray app that supervises the server and shows the web UI in a window. See [architecture Â§7](../../docs/architecture.md#desktop-shell-appsdesktop).

**Status:** working shell. Single instance, tray, server supervisor (spawn or attach), frameless window with close-to-tray, bundled Starting/Failed page, mini player, keep-awake, toasts, Settings > Desktop (in the web UI), telemetry and the automated launch smoke test are in place.

## What is here

| Path                                                            | What it is                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/telemetry/config.ts`                                       | Reads `SENTRY_DSN_WEB`, `POSTHOG_API_KEY`, `POSTHOG_HOST`, `HOMESTREAM_TELEMETRY` from the environment                                                                                                                          |
| `src/telemetry/sentry.ts`                                       | `buildMainSentryOptions()`: the `Sentry.init` options for the main process (null when telemetry is off)                                                                                                                         |
| `src/telemetry/scrub.ts`                                        | The scrubber: `packages/shared` sanitizer plus the machine and user name                                                                                                                                                        |
| `src/telemetry/analytics.ts`                                    | Typed PostHog client for catalog events (`desktop_started`)                                                                                                                                                                     |
| `src/main.ts`, `src/shell/`                                     | Electron glue (not unit tested, covered by the launch smoke test): app start, single-instance lock, tray, windows, menu, toasts                                                                                                 |
| `src/preload.cts`                                               | The `window.homestream` bridge: one `ipcRenderer.invoke` per call, no generic passthrough                                                                                                                                       |
| `src/supervisor.ts`                                             | Attach-or-spawn server supervisor: restart backoff 1/2/5 s, at most 5 a minute, then `failed`. A non-HomeStream program on the server port spawns nothing and fails at once (`EADDRINUSE`, "Port N is used by another program") |
| `src/permissions.ts`                                            | Session permissions: `fullscreen`, and `keyboardLock` for the server origin only (Escape reaches the player first in fullscreen)                                                                                                |
| `src/windowBounds.ts`                                           | Puts the main window on the saved rectangle exactly (the constructor adds the invisible resize border)                                                                                                                          |
| `src/trayModel.ts`, `src/monitor.ts`, `src/sse.ts`              | Tray state, tooltip and menu from health (at most every 60 s) and the server event stream                                                                                                                                       |
| `src/ipc.ts`                                                    | The channel allow-list and validation of every IPC call                                                                                                                                                                         |
| `src/settings.ts`, `src/windowState.ts`                         | `desktop-settings.json` and `window-state.json` in the user-data folder                                                                                                                                                         |
| `src/miniPlayer.ts`, `src/keepAwake.ts`, `src/notifications.ts` | Mini-player hand-over rules, `powerSaveBlocker` choice, toast text and rules                                                                                                                                                    |
| `src/logger.ts`                                                 | JSON-lines logger that scrubs every line and feeds Sentry breadcrumbs                                                                                                                                                           |
| `src/requestId.ts`                                              | `withRequestId()`: adds `X-Request-ID` to every call the shell makes to the server                                                                                                                                              |
| `test/`, `test/integration/`                                    | Unit tests, and tests of several modules together (telemetry wiring; the supervisor goes here)                                                                                                                                  |

## Commands

Run from the repository root.

```powershell
pnpm --filter @homestream/desktop typecheck
pnpm --filter @homestream/desktop lint
pnpm --filter @homestream/desktop test
pnpm --filter @homestream/desktop test:coverage   # thresholds in coverage-thresholds.json (they may only go up)
pnpm --filter @homestream/desktop build           # tsc to dist/, plus the tray icons and loading page
pnpm --filter @homestream/desktop start -- --remote-debugging-port=8622 --user-data-dir=D:\HomeStream\electron-validate   # run the built app from the source tree
pnpm --filter @homestream/desktop smoke           # launch smoke test: needs the server, web and desktop builds and the Electron binary
```

Tests never start Electron: main-process logic takes its Electron and network dependencies as arguments, so it runs under plain Node in CI.

## Electron install

`electron` downloads its binary into a cache on first use. Keep that cache off the C: drive:

```powershell
$env:ELECTRON_CACHE = 'E:\HomeStream\cache\electron'
node apps/desktop/node_modules/electron/install.js    # downloads dist/electron.exe if it is missing
apps/desktop/node_modules/electron/dist/electron.exe --version   # v45.x
```

The unit tests never launch it. The `Windows` CI job installs it and runs the launch smoke tests (`pnpm smoke`, files in `test/smoke/`, shared helpers in `harness.ts`). Both start the built app with the built server and web UI in a throw-away user-data and data folder under `HOMESTREAM_TEST_ROOT`, and both end the app with a second launch using `--quit`, then check that the exit code is 0, the server port no longer answers and none of the Electron or server processes (by pid) is left.

- `launch.smoke.ts` is the first run (ports 8616 and 8617): the 20-member bridge, the server status line, the tray tooltip, the first-run screen and `desktop-settings.json`.
- `configured.smoke.ts` is the configured launch (ports 8618 and 8619): an env file with invented keys, TMDB and the gateway served by the e2e stub hub of the web app (`apps/web/e2e/support/hub.mjs`, `redirect-fetch.mjs`, ports from `apps/web/e2e/ports.json`), no real key and no playback session. It waits until Home shows its poster rows (the `hs:home-content` mark, no first-run screen, the Trending Movies row with posters), not only for the window.

Teardown (`teardownSmoke` in `harness.ts`, logic in `teardown.ts`) keeps the pids of the launcher, Electron, its children and the server, and stops the survivors by pid (a gentle stop, then a kill) even when the launcher already exited. The stub hub stop, the shell stop and the temp-folder removal are independent steps: each runs when an earlier one throws, and a folder that cannot be removed never fails the run.

The wait condition, the process-table helpers and the teardown (with fake processes) are unit tested in `test/smokeHarness.test.ts`.

## Telemetry plan for the main process (`@sentry/electron` 8.3)

This is how the shell wires telemetry (`src/shell/telemetry.ts`).

1. Load the config file (`%APPDATA%\HomeStream\config.env` when packaged, `.env` in development) into `process.env`, then call `resolveTelemetryConfig(process.env, app.isPackaged)`.
2. Build the scrubber (`createMainScrubber([appRoot, process.resourcesPath])`) and call `buildMainSentryOptions({ config, version: app.getVersion(), scrubber })`. When it returns options, call `Sentry.init(options)` from `@sentry/electron/main` **before** `app.whenReady()`, as `@sentry/electron` requires.
3. The main process reports to the Sentry project `homestream-web` (the DSN in `SENTRY_DSN_WEB`) with release `homestream@<version>` and the tags `process=main`, `app=desktop`, `device.kind=desktop`. The renderer is the web UI and reports as `process=renderer` through `@sentry/react`; do not enable the Electron SDK's renderer integration, so the web UI's own scrubber stays the only path out of a renderer.
4. Create the logger with `scrub: scrubber.text`, a file sink in `DATA_DIR` and `breadcrumb: (level, message) => Sentry.addBreadcrumb(mainBreadcrumb(level, message))` (category `main`, `warn` becomes `warning`).
5. Every request the shell makes to the server (`/api/info` probes, the `/api/events` stream, shutdown) goes through `withRequestId()`.
6. After the window is created, send `desktop_started` once through `createDesktopAnalytics()` (install id: a random UUID kept in the user-data directory) and `shutdown()` the client on quit.
7. Nothing in this path may block start-up or throw: telemetry is created after the window is shown, off the critical path.

With no `SENTRY_DSN_WEB` and no `POSTHOG_API_KEY`, or with `HOMESTREAM_TELEMETRY=off`, no client starts and the shell makes no telemetry request. What is sent is listed in [docs/PRIVACY.md](../../docs/PRIVACY.md).

**Test trigger.** Starting the shell with `HOMESTREAM_TELEMETRY_TEST=<run id>` (lowercase letters, digits and dashes, at most 40) and `SENTRY_DSN_WEB` set reports one deliberate main-process error (`HomeStream desktop telemetry test error`, tag `telemetry_test_run`) once the shell has started, then flushes. Without a DSN, or with any other value, nothing happens.
