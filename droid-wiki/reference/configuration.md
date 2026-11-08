# Configuration

The server selects one env-format file, overlays recognized nonblank process variables and derives typed defaults. Restart after changes; browser build inputs and device-local preferences have different lifetimes (`apps/server/src/config.ts`, `apps/web/vite.config.ts`). See [getting started](../overview/getting-started.md).

## File selection

`loadConfig` in `apps/server/src/config.ts` selects, in order:

1. A nonblank process `HOMESTREAM_ENV_FILE`, even if the file is missing.
2. An existing repository `.env`, when a repository root was supplied.
3. An existing app-data `HomeStream/config.env`.
4. The intended repository/app-data path when no file exists.

There is no multi-file merge or fallback after an explicit missing path. Recognized process values are trimmed and override trimmed file values only when nonblank. Unknown file keys do not enter server `Config`.

Process `HOMESTREAM_PACKAGED=1` suppresses repository discovery in `apps/server/src/index.ts`; explicit env-file selection still wins. `APPDATA` supplies the app-data base, otherwise the loader uses the home directory's `AppData/Roaming`. These selectors are separate from runtime `KNOWN_KEYS`.

The file is parsed with Node's env-file parser, not executed as a shell script. A read/parse failure contributes a warning and empty file values; recognized process overrides can still supply configuration. Loading server `Config` does not copy file values into `process.env` (`apps/server/src/config.ts`).

## Server settings

All rows below come from `apps/server/src/config.ts`; network validation delegates to `apps/server/src/network/limits.ts`.

| Key                     | Default                              | Meaning                                                          |
| ----------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `GATEWAY_MANIFEST_URL`  | Unset                                | Gateway credential-bearing manifest URL                          |
| `TMDB_READ_TOKEN`       | Unset                                | TMDB read token                                                  |
| `TORBOX_API_KEY`        | Unset                                | Optional TorBox caching/account key                              |
| `TORBOX_API_URL`        | `https://api.torbox.app`             | Download-poller origin                                           |
| `PORT`                  | 8600                                 | Public port, integer 0–65535; 0 is random for tests              |
| `SOURCE_PROXY_PORT`     | `PORT + 50`                          | Loopback proxy port; public port 0 or derived overflow selects 0 |
| `SERVER_NAME`           | `HomeStream on <hostname>`           | Local display/discovery name                                     |
| `HOMESTREAM_WEB_DIR`    | Caller web directory, otherwise null | Built UI to serve                                                |
| `HOMESTREAM_MDNS`       | On                                   | `0`, `false`, `off`, `no` disable advertisement                  |
| `DATA_DIR`              | Windows `E:\HomeStream\data`         | SQLite and process logs                                          |
| `TRANSCODE_DIR`         | Windows `E:\HomeStream\transcode`    | Temporary HLS data                                               |
| `TRANSCODE_MAX_GB`      | 20                                   | Positive segment-disk budget, interpreted as GiB                 |
| `DISK_WARN_FREE_GB`     | 20                                   | Nonnegative free-space warning level; fixed error threshold is 5 |
| `FFMPEG_PATH`           | `ffmpeg`                             | Encoder executable                                               |
| `FFPROBE_PATH`          | `ffprobe`                            | Probe executable                                                 |
| `FFMPEG_THREADS`        | 4                                    | Positive GPU-filter job thread cap                               |
| `FFMPEG_BURN_THREADS`   | 8                                    | Positive CPU-filter/burn-in thread cap                           |
| `FFMPEG_MAX_RSS_MB`     | 4096                                 | Positive per-process watchdog limit in MiB                       |
| `HEALTH_NVENC_TEST`     | On                                   | `0`, `false`, `off`, `no` disable health test encoding           |
| `MAX_DOWNLOAD_MBPS`     | 150                                  | Shared upstream cap, decimal megabits/s; minimum 5               |
| `READ_AHEAD_SEC`        | 180                                  | Positive encoder lead ceiling                                    |
| `READ_AHEAD_RESUME_SEC` | 120                                  | Positive resume lead, below ceiling                              |
| `LOG_LEVEL`             | `info`                               | `debug`, `info`, `warn`, or `error`                              |
| `HOMESTREAM_TELEMETRY`  | Not disabled                         | Off tokens suppress both optional clients                        |
| `SENTRY_DSN_SERVER`     | Unset                                | Optional server error-reporting DSN                              |
| `SENTRY_ENVIRONMENT`    | `development`, packaged `production` | Report environment                                               |
| `POSTHOG_API_KEY`       | Unset                                | Optional analytics key                                           |
| `POSTHOG_HOST`          | `https://us.i.posthog.com`           | HTTP(S) ingestion origin                                         |

The public host is fixed to all interfaces; no `HOST` key exists. Keep it on a trusted LAN. Use writable absolute storage paths on non-Windows machines rather than accepting the Windows defaults. Port conventions for manual services are 8600–8699 (`AGENTS.md`).

Invalid values warn and fall back, rather than silently widening budgets. If the effective resume lead is at/above its ceiling, both values revert to 180/120. A disk warning level at/below 5 is accepted with a warning: the fixed error threshold remains, so there may be no warning-only interval (`apps/server/src/config.ts`, `apps/server/src/network/limits.ts`). See [network](../systems/network.md) and [health](../systems/health.md).

Missing required gateway/TMDB keys populate warnings without preventing listener startup. Credential values are registered with the redactor (`apps/server/src/index.ts`, `apps/server/src/config.ts`).

Disabling mDNS changes advertisement only, not the wildcard HTTP listener. `/api/info` and mDNS use the same ranked IPv4 helper: physical non-link-local candidates win, but virtual/link-local candidates return when they are all the host has (`apps/server/src/net.ts`, `apps/server/src/discovery.ts`). See [server](../apps/server.md) and [security](../security.md).

## Browser build and runtime

The web build embeds `SENTRY_DSN_WEB`, `POSTHOG_API_KEY`, and `POSTHOG_HOST`, with process values overriding repository env inputs. `HOMESTREAM_TELEMETRY` off tokens disable clients. Build/upload inputs also include `SENTRY_RELEASE`, `SENTRY_ENVIRONMENT`, `HOMESTREAM_RELEASE_BUILD`, `SENTRY_AUTH_TOKEN`, and `SENTRY_ORG`; upload credentials are not browser configuration (`apps/web/vite.config.ts`, `apps/web/src/telemetry/buildEnv.ts`).

At runtime, `localStorage['homestream.telemetry']='off'` disables renderer telemetry. A keyless build cannot acquire keys from the running server. The deliberate browser error trigger only exists in builds with `HOMESTREAM_TELEMETRY_STUB=1` (`apps/web/src/telemetry/config.ts`, `apps/web/src/telemetry/index.ts`).

Vite uses port 8601 and proxies API/HLS to 8600; changing server `PORT` does not change the proxy target (`apps/web/vite.config.ts`). See [web startup](../apps/web/data-and-startup.md).

## Device-local preferences

The actual Settings/About UI is not a server env-file editor. Its ownership is split across local browser storage, device registration and Electron settings (`apps/web/src/pages/SettingsPage.tsx`, `apps/desktop/src/settings.ts`).

| Store                   | Keys/defaults                                                                                                                                                           | Boundary                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser localStorage    | `homestream.deviceId` random UUID; `homestream.deviceName` or default display name                                                                                      | Name saving also posts capabilities to `/api/devices`; identity is not authentication (`apps/web/src/device/identity.ts`)                                       |
| Browser localStorage    | `homestream.hideSpoilers`: absent means on; only `off` disables                                                                                                         | Default-on hiding for unfinished episodes; blocked storage uses a page-lifetime fallback; no HTTP write or SQLite column (`apps/web/src/lib/spoilers.ts`)       |
| Browser localStorage    | `homestream.telemetry=off`                                                                                                                                              | Renderer opt-out after reload, independent of server/main clients (`apps/web/src/telemetry/config.ts`)                                                          |
| Electron user-data file | `desktop-settings.json`: `startMinimized=true`, `closeBehaviour=tray`, `notifyReady=true`, `notifyFailures=true`, `hardwareAcceleration=true`, `closeNoticeShown=false` | Missing/invalid fields independently default; only the shell can mark the close notice shown (`packages/shared/src/desktop.ts`, `apps/desktop/src/settings.ts`) |

Windows login startup is an OS login-item setting, separate from `startMinimized`, which controls the hidden launch argument. Hardware acceleration is read before Electron readiness and requires an app restart to take effect (`apps/desktop/src/main.ts`, `apps/desktop/src/shell/shell.ts`). See [Settings and spoilers](../apps/web/settings-and-spoilers.md) and [desktop integration](../apps/web/desktop-integration.md).

## Desktop and tooling inputs

The shell selects an env file, copies only its seven recognized shell keys into missing/blank process values, and passes the selected config path to its server child; the child reads its own server keys. These shell keys are `SENTRY_DSN_WEB`, `SENTRY_ENVIRONMENT`, `POSTHOG_API_KEY`, `POSTHOG_HOST`, `HOMESTREAM_TELEMETRY`, `DATA_DIR` and `PORT` (`apps/desktop/src/envFile.ts`, `apps/desktop/src/main.ts`). Packaged and source launches differ; use [desktop](../apps/desktop/index.md) for ownership and writable files.

Unlike the server's test-friendly port 0, `portFrom` for the desktop shell accepts only **1–65535** and otherwise uses 8600 (`apps/desktop/src/envFile.ts`). `HOMESTREAM_TELEMETRY_TEST` is a deliberate main-process test-error trigger, not a normal server setting (`apps/desktop/src/shell/telemetry.ts`).

Other inputs in `.env.example` belong to specific consumers:

| Input                                      | Consumer                                               |
| ------------------------------------------ | ------------------------------------------------------ |
| `POSTHOG_PERSONAL_API_KEY`                 | Remote flag-management script, not ingestion           |
| `SENTRY_API_TOKEN`, `SENTRY_ORG`           | Alert/issue tooling                                    |
| `SENTRY_AUTH_TOKEN`                        | Source-map and release upload                          |
| `SENTRY_DSN_TV`                            | Reserved for planned TV client                         |
| `HOMESTREAM_TEST_ROOT`                     | Test temporary directories                             |
| `GITLEAKS_PATH`                            | Pre-commit scanner executable                          |
| `METRICS_REMOTE`                           | CI timing branch publication                           |
| `FACTORY_API_KEY`, `FACTORY_WIKI_PR_TOKEN` | Repository automation secrets, not local runtime setup |

Consumers are `scripts/flags.mjs`, `scripts/sentry-alerts.mjs`, `scripts/sentry-issues.mjs`, `apps/server/test/helpers.ts`, `scripts/pre-commit-secrets.mjs`, `scripts/lib/metrics-branch.mjs`, and the workflows under `.github/workflows`. Script env loading is separate from server selection; never assume the server loader supplies a CLI's environment.

New runtime settings require `KNOWN_KEYS`, typed config, `.env.example`, defaults and tests. See [conventions](../how-to-contribute/patterns-and-conventions.md) and [security](../security.md). Defaults above were source-checked at **`0a8f04f`, 2026-11-08**, not read from a live installation.
