# Desktop shell

Active contributors: VeroxAUS

## Purpose

The Electron 45 desktop app is a working single-instance tray shell around the server-hosted [web UI](../web/index.md). It supervises a local server, opens the main and mini-player windows, persists preferences, exposes a restricted preload bridge, and integrates Windows startup, notifications and power management. It does not import web or server implementation modules.

The player and shell are implemented; dashboard tabs remain limited/placeholder views and the Android TV app has no source directory. Shared TV capability contracts do not imply a shipped TV app.

## Layout and key abstractions

| Boundary | Source | Responsibility |
| --- | --- | --- |
| Bootstrap | `apps/desktop/src/main.ts` | Single-instance lock, environment, pre-ready settings, telemetry and lifecycle |
| `Shell` | `apps/desktop/src/shell/shell.ts` | Windows, tray, IPC, monitoring and graceful quit composition |
| `Supervisor` | `apps/desktop/src/supervisor.ts` | Owned child versus external attachment, readiness, retries and shutdown |
| `ServerMonitor` | `apps/desktop/src/monitor.ts` | SSE, activity reconciliation and health |
| `SettingsStore` | `apps/desktop/src/settings.ts` | Validated, atomic desktop preferences |
| `MiniPlayerState` | `apps/desktop/src/miniPlayer.ts` | One-session renderer handoff |
| `KeepAwake` | `apps/desktop/src/keepAwake.ts` | At most one power-save blocker |

`apps/desktop/src/shell/` contains Electron adapters; sibling source modules hold injectable policy, file and process seams. Telemetry support lives in `apps/desktop/src/telemetry/`; outbound SDK behavior belongs to [telemetry](../../systems/telemetry.md).

## Startup and lifetime

`apps/desktop/src/main.ts` names the app HomeStream and selects the HomeStream user-data directory unless Chromium's user-data override is present. The lock is acquired before startup: another normal launch focuses the main window; another launch with `--quit` asks the existing instance to shut down. `--hidden`, parsed in `apps/desktop/src/cli.ts`, starts directly to the tray.

Desktop preferences and hardware acceleration are read before Electron becomes ready. After readiness, the shell installs permissions, IPC and tray, optionally opens the window, and starts server supervision. Closing every window does not quit the app. All quit requests use one shared shutdown promise: stop monitoring, release power management, destroy mini, stop only the owned server, destroy tray, flush telemetry, destroy main, then exit.

Read [server supervision](supervisor.md) for ownership, crash recovery and activity correctness, and [windows and IPC](windows-and-ipc.md) for renderer trust and handoff.

## Settings and configuration

`apps/desktop/src/settings.ts` recovers missing or malformed fields independently rather than discarding all valid preferences. Defaults come from `packages/shared/src/desktop.ts`: minimized startup, tray close, ready/failure notifications and hardware acceleration enabled; close notice not yet shown.

Updates accept only five renderer-editable keys with the correct value type. The one-time close-notice marker is shell-only. `apps/desktop/src/jsonFile.ts` writes a temporary file and renames it; preferences change in memory and notify listeners only after a successful write. `desktop-settings.json`, `window-state.json` and the random telemetry installation ID are stored under Electron user data.

Windows autostart uses Electron login-item settings, not a JSON preference. Its arguments include `--hidden` only when minimized startup is selected; changing that setting rewrites an already-enabled login item (`apps/desktop/src/shell/shell.ts`). Hardware acceleration is applied on the next process launch.

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

`apps/desktop/vitest.config.ts` runs offline Node tests and excludes main/bootstrap and Electron shell adapters from coverage. Separate `apps/desktop/vitest.smoke.config.ts` launches real Electron. `apps/desktop/test/smoke/launch.smoke.ts` checks the exact 20-member bridge, owned-server status, visible first-run UI/tray, persisted preference, and second-instance quit stopping both app and owned server. It requires built server/web/desktop and Electron, isolates data/user data, disables telemetry/mDNS and uses ports 8616–8617. It is not part of ordinary unit tests and is Windows-oriented, including its fallback cleanup.

Start policy changes in the injectable module, add its unit regression, then change the Electron adapter. Renderer work belongs in [desktop integration](../web/desktop-integration.md); contract changes belong in [shared](../../packages/shared.md).

## Key source files

| File | Purpose |
| --- | --- |
| `apps/desktop/src/main.ts` | Executed bootstrap |
| `apps/desktop/src/shell/shell.ts` | Application composition and shutdown |
| `apps/desktop/src/settings.ts` | Field recovery and validated updates |
| `apps/desktop/src/envFile.ts` | Environment resolution and missing-file template |
| `apps/desktop/src/jsonFile.ts` | Atomic JSON persistence |
| `apps/desktop/src/logger.ts` | Injected structured, scrubbed logging |
| `apps/desktop/src/requestId.ts` | Request correlation |
| `apps/desktop/test/settingsFile.test.ts` | Preference and write-failure regressions |
| `apps/desktop/test/launchAndEnv.test.ts` | Launch/environment/startup-page cases |
| `apps/desktop/test/smoke/launch.smoke.ts` | Real-runtime launch validation |

## Measured scope

At `5eefa37`, committed `apps/desktop/src/` has **31 TypeScript source files**, including the `.cts` preload; `apps/desktop/test/` has **17 test files** (16 `.test.ts`, one `.smoke.ts`), plus one excluded CDP helper. Test/source file ratio: **0.55**. Counts use `git ls-tree -r --name-only origin/main`, excluding configs/assets/build outputs. Scoped default-branch history has **1 unique human author**, VeroxAUS, matching CODEOWNERS. These are inventory counts, not coverage or a claim that tests were run for this documentation.
