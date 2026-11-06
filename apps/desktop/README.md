# @homestream/desktop

The Electron 45 desktop shell for HomeStream: a tray app that supervises the server and shows the web UI in a window. See [architecture §7](../../docs/architecture.md#desktop-shell-appsdesktop).

**Status:** skeleton. The package, its checks and the main-process telemetry plan are in place. The Electron shell itself (main process, tray, supervisor, preload) is built by the `electron-shell` feature.

## What is here

| Path                         | What it is                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/telemetry/config.ts`    | Reads `SENTRY_DSN_WEB`, `POSTHOG_API_KEY`, `POSTHOG_HOST`, `HOMESTREAM_TELEMETRY` from the environment  |
| `src/telemetry/sentry.ts`    | `buildMainSentryOptions()`: the `Sentry.init` options for the main process (null when telemetry is off) |
| `src/telemetry/scrub.ts`     | The scrubber: `packages/shared` sanitizer plus the machine and user name                                |
| `src/telemetry/analytics.ts` | Typed PostHog client for catalog events (`desktop_started`)                                             |
| `src/logger.ts`              | JSON-lines logger that scrubs every line and feeds Sentry breadcrumbs                                   |
| `src/requestId.ts`           | `withRequestId()`: adds `X-Request-ID` to every call the shell makes to the server                      |
| `test/`, `test/integration/` | Unit tests, and tests of several modules together (telemetry wiring; the supervisor goes here)          |

## Commands

Run from the repository root.

```powershell
pnpm --filter @homestream/desktop typecheck
pnpm --filter @homestream/desktop lint
pnpm --filter @homestream/desktop test
pnpm --filter @homestream/desktop test:coverage   # thresholds in coverage-thresholds.json (they may only go up)
pnpm --filter @homestream/desktop build           # tsc to dist/
```

Tests never start Electron: main-process logic takes its Electron and network dependencies as arguments, so it runs under plain Node in CI.

## Electron install

`electron` downloads its binary into a cache on first use. Keep that cache off the C: drive:

```powershell
$env:ELECTRON_CACHE = 'E:\HomeStream\cache\electron'
node apps/desktop/node_modules/electron/install.js    # downloads dist/electron.exe if it is missing
apps/desktop/node_modules/electron/dist/electron.exe --version   # v45.x
```

CI does not need the binary: the tests above never launch it.

## Telemetry plan for the main process (`@sentry/electron` 8.3)

The `electron-shell` feature wires this in; the pure parts already exist and are tested.

1. Load the config file (`%APPDATA%\HomeStream\config.env` when packaged, `.env` in development) into `process.env`, then call `resolveTelemetryConfig(process.env, app.isPackaged)`.
2. Build the scrubber (`createMainScrubber([appRoot, process.resourcesPath])`) and call `buildMainSentryOptions({ config, version: app.getVersion(), scrubber })`. When it returns options, call `Sentry.init(options)` from `@sentry/electron/main` **before** `app.whenReady()`, as `@sentry/electron` requires.
3. The main process reports to the Sentry project `homestream-web` (the DSN in `SENTRY_DSN_WEB`) with release `homestream@<version>` and the tags `process=main`, `app=desktop`, `device.kind=desktop`. The renderer is the web UI and reports as `process=renderer` through `@sentry/react`; do not enable the Electron SDK's renderer integration, so the web UI's own scrubber stays the only path out of a renderer.
4. Create the logger with `scrub: scrubber.text`, a file sink in `DATA_DIR` and `breadcrumb: (level, message) => Sentry.addBreadcrumb({ category: 'main', level, message })`.
5. Every request the shell makes to the server (`/api/info` probes, the `/api/events` stream, shutdown) goes through `withRequestId()`.
6. After the window is created, send `desktop_started` once through `createDesktopAnalytics()` (install id: a random UUID kept in the user-data directory) and `shutdown()` the client on quit.
7. Nothing in this path may block start-up or throw: telemetry is created after the window is shown, off the critical path.

With no `SENTRY_DSN_WEB` and no `POSTHOG_API_KEY`, or with `HOMESTREAM_TELEMETRY=off`, no client starts and the shell makes no telemetry request. What is sent is listed in [docs/PRIVACY.md](../../docs/PRIVACY.md).
