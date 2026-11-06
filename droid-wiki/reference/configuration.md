# Configuration

The server reads one env-format file, overlays recognized process variables and derives typed defaults. Changes require restart; file-loaded keys do not become shell environment variables (`apps/server/src/config.ts`). Setup is covered in [getting started](../overview/getting-started.md).

## File selection and precedence

`loadConfig` in `apps/server/src/config.ts` chooses exactly one file:

1. A nonblank **process** `HOMESTREAM_ENV_FILE` selects that path, even if absent.
2. Otherwise, an existing repository-root env file wins when a repository root was supplied.
3. Otherwise, an existing `%APPDATA%\HomeStream\config.env` wins. If `APPDATA` is blank, the base is the home directory's `AppData\Roaming`.
4. If neither exists, the intended path is the repository env file when a root exists, otherwise the app-data path.

There is no merge of multiple files and no fallback after selecting an explicit missing path. Node `parseEnv` reads the selected file; unreadable content adds a warning.

For each `KNOWN_KEYS` entry, a **trimmed nonblank process value wins over a trimmed nonblank file value**, then the code default. A blank process value does not erase a file value. Unknown keys are not loaded into `Config`.

`apps/server/src/index.ts` discovers the repository via `pnpm-workspace.yaml`; process `HOMESTREAM_PACKAGED=1` suppresses that discovery and changes the default Sentry environment. Explicit `HOMESTREAM_ENV_FILE` still wins in packaged mode. These selectors, and `APPDATA`, are process inputs outside `KNOWN_KEYS`; placing `HOMESTREAM_PACKAGED` in the selected file does not activate packaged discovery rules.

## Server runtime keys

The following groups enumerate every `KNOWN_KEYS` entry in `apps/server/src/config.ts`.

### Services and HTTP

| Key                    | Default                        | Behavior                                                                          |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| `GATEWAY_MANIFEST_URL` | Unset/null                     | Required for stream gateway use; treat URL as a credential                        |
| `TMDB_READ_TOKEN`      | Unset/null                     | Required for TMDB                                                                 |
| `TORBOX_API_KEY`       | Unset/null                     | Optional TorBox health/download credential                                        |
| `TORBOX_API_URL`       | `https://api.torbox.app`       | HTTP(S) origin for download poller, mainly a test seam                            |
| `PORT`                 | `8600`                         | Integer 0–65535; 0 selects a free port                                            |
| `SOURCE_PROXY_PORT`    | `PORT + 50`                    | Loopback proxy; 0 selects a free port; public 0 or derived overflow defaults to 0 |
| `SERVER_NAME`          | `HomeStream on <hostname>`     | Local discovery/client display name                                               |
| `HOMESTREAM_WEB_DIR`   | Caller default, otherwise null | Normal entry derives the web build directory                                      |

The public bind host is fixed to `0.0.0.0`; there is no `HOST` key. The proxy binds to loopback and can choose a free port when its requested one is occupied (`apps/server/src/sourceproxy/proxy.ts`). Keep manually started services within the repository's 8600–8699 convention; `PORT=0` is for isolated tests.

`TORBOX_API_URL` changes the poller, **not** the account-health URL hardcoded in `apps/server/src/health/checks/torbox.ts`.

### Storage and encoding

| Key                   | Default                   | Validation/use                                                               |
| --------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| `DATA_DIR`            | `E:\HomeStream\data`      | SQLite and process logs                                                      |
| `TRANSCODE_DIR`       | `E:\HomeStream\transcode` | HLS session files                                                            |
| `TRANSCODE_MAX_GB`    | `20`                      | Positive finite number; playback interprets as GiB                           |
| `FFMPEG_PATH`         | `ffmpeg`                  | Executable name/path                                                         |
| `FFPROBE_PATH`        | `ffprobe`                 | Executable name/path                                                         |
| `FFMPEG_THREADS`      | `4`                       | Positive integer; GPU-filter job thread cap                                  |
| `FFMPEG_BURN_THREADS` | `8`                       | Positive integer; CPU-filter/burn-in job thread cap                          |
| `FFMPEG_MAX_RSS_MB`   | `4096`                    | Positive integer; per-process watchdog limit in MiB                          |
| `HEALTH_NVENC_TEST`   | On                        | `0`, `false`, `off`, `no` disable the health test encode, case-insensitively |

The Windows drive paths are literal current defaults, not platform-aware examples. Set usable paths on Linux/macOS rather than accepting Windows-style strings (`apps/server/src/config.ts`).

The shared watchdog samples watched FFmpeg PIDs every **1 s**. Strictly exceeding the per-process working-set limit triggers a stop, with **2 s** grace before forced termination; it is separate from Node RSS alerts (`apps/server/src/playback/memoryWatchdog.ts`). See [playback lifecycle](../systems/playback/lifecycle.md).

### Network budget and logs

| Key                     | Default | Validation/use                                              |
| ----------------------- | ------- | ----------------------------------------------------------- |
| `MAX_DOWNLOAD_MBPS`     | `150`   | Finite number ≥5, shared upstream cap in decimal megabits/s |
| `READ_AHEAD_SEC`        | `180`   | Finite seconds >0                                           |
| `READ_AHEAD_RESUME_SEC` | `120`   | Finite seconds >0 and below read-ahead ceiling              |
| `LOG_LEVEL`             | `info`  | `debug`, `info`, `warn`, `error`, case-insensitively        |

Invalid network numbers warn and use defaults, rather than clamping. If the effective resume value is at/above the ceiling, **both** read-ahead values revert to 180/120 (`apps/server/src/network/limits.ts`). Mbps converts with 1,000,000 bits/s; memory/disk limits use binary units. See [network controls](../systems/network.md) and [logging](../how-to-monitor/logging.md).

### Runtime telemetry

| Key                    | Default                    | Behavior                                                           |
| ---------------------- | -------------------------- | ------------------------------------------------------------------ |
| `HOMESTREAM_TELEMETRY` | No forced disable          | `off`, `0`, `false`, `no`, `disabled` disable both clients         |
| `SENTRY_DSN_SERVER`    | Unset/null                 | Optional server error reporting; unparsable URL warns and disables |
| `SENTRY_ENVIRONMENT`   | `development`              | `production` when process packaged selector is `1`                 |
| `POSTHOG_API_KEY`      | Unset/null                 | Optional analytics and remote flags                                |
| `POSTHOG_HOST`         | `https://us.i.posthog.com` | HTTP(S) origin                                                     |

The master switch nulls the effective client keys. Merely omitting it does not enable transmission without keys. Invalid HTTP origins warn and fall back; valid origins discard paths/query components (`apps/server/src/config.ts`). See [telemetry](../systems/telemetry.md) for client startup failure and local flag defaults.

## Browser build-time configuration

The browser does not fetch telemetry credentials from the server. `apps/web/vite.config.ts` reads Vite's mode-aware env files at the repository root, then overlays `process.env`, and embeds only the resulting `HS_TELEMETRY` object. Unlike the server's nonblank overlay, this spread permits an empty process value to override a file value; `nonEmpty` then turns it into null (`apps/web/src/telemetry/buildEnv.ts`).

| Input                             | Build behavior/default                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SENTRY_DSN_WEB`                  | Optional renderer DSN; null without a nonblank value                                                                           |
| `POSTHOG_API_KEY`                 | Optional renderer analytics key; null without a nonblank value                                                                 |
| `POSTHOG_HOST`                    | Optional baked-in host; resolver defaults to `https://us.i.posthog.com`                                                        |
| `HOMESTREAM_TELEMETRY`            | `off`, `0`, `false`, `no`, `disabled` disable telemetry, case-insensitively                                                    |
| `SENTRY_RELEASE`                  | `homestream@0.1.0`, derived from `apps/web/package.json`                                                                       |
| `SENTRY_ENVIRONMENT`              | `production`, independent of the server's packaged-mode default                                                                |
| `HOMESTREAM_TELEMETRY_STUB`       | Only literal `1` enables the deliberate-error e2e trigger                                                                      |
| `HOMESTREAM_RELEASE_BUILD`        | Only literal `1`, a nonblank `SENTRY_AUTH_TOKEN`, and telemetry not off enable hidden source maps and the Sentry upload plugin |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` | Build/upload inputs, not embedded in `HS_TELEMETRY`; project is `homestream-web`                                               |

Sources: `apps/web/vite.config.ts`, `apps/web/src/telemetry/buildEnv.ts`, `apps/web/src/telemetry/config.ts`. Test mode sets both SDK keys and the host to null. Plain builds produce no source maps; upload builds configure deletion of uploaded maps from `dist`.

At browser runtime, `localStorage['homestream.telemetry']='off'` disables both clients. No baked key means no matching client; neither key means the resolver returns null. Changing server runtime keys cannot add credentials to an already-built browser bundle (`apps/web/src/telemetry/config.ts`). Initialization is deferred until content and idle time; see [telemetry](../systems/telemetry.md) and [web build and tests](../apps/web/build-and-tests.md).

The Vite development server requests port **8601**, forwarding `/api` and `/hls` to `http://127.0.0.1:8600`; it does not derive that target from server `PORT` (`apps/web/vite.config.ts`). See [web data and startup](../apps/web/data-and-startup.md).

## Desktop configuration support

`apps/desktop/src/telemetry/config.ts` resolves supplied process variables: `SENTRY_DSN_WEB`, `POSTHOG_API_KEY`, `POSTHOG_HOST`, `SENTRY_ENVIRONMENT` and the same case-insensitive telemetry off values. Invalid DSNs become null; invalid hosts fall back to the US ingestion origin. Its `packaged` argument selects the default environment (`production` versus `development`).

This is a pure support function, not an implemented desktop env-file loader. Loading `%APPDATA%\HomeStream\config.env` and wiring SDK initialization are future shell work (`apps/desktop/README.md`). No matching key means no matching client. See [desktop](../apps/desktop.md).

## Tooling keys are a different surface

`.env.example` includes more than server `KNOWN_KEYS`; do not add them to the runtime settings table by implication.

| Key/input                           | Consumer                                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_ORG`, `SENTRY_API_TOKEN`    | Personal-token Sentry alert management (`scripts/sentry-alerts.mjs`); issue sync also needs them                                             |
| `SENTRY_AUTH_TOKEN`                 | CI Sentry releases, distinct from the personal token (`.github/workflows/release.yml`)                                                       |
| `SENTRY_DSN_WEB`, `SENTRY_DSN_TV`   | Web DSN is consumed at browser build time and by desktop support; TV DSN is reserved for the planned client. Neither is a server runtime key |
| `POSTHOG_PERSONAL_API_KEY`          | Flag creation tooling (`scripts/flags.mjs`), not event ingestion                                                                             |
| `GITHUB_TOKEN`, `GITHUB_REPOSITORY` | Issue sync process environment (`scripts/sentry-issues.mjs`)                                                                                 |
| `HOMESTREAM_TEST_ROOT`              | Test temp-directory selection (`apps/server/test/helpers.ts`)                                                                                |
| `GITLEAKS_PATH`                     | Pre-commit scanner executable selection (`scripts/pre-commit-secrets.mjs`)                                                                   |

Alert/flag scripts use `scripts/lib/dotenv.mjs` to overlay nonempty process values on the repository env file; they do not implement the server's app-data/explicit-file selection. Issue sync reads its supplied process environment directly. Configure secrets through the appropriate local/CI mechanism rather than assuming the server loader supplies them.

## Failure handling and changes

Missing required keys populate `missingKeys` and warn without preventing the listener from opening. Invalid ports/numbers/log levels generally warn and fall back; downstream health and routes still report unusable services (`apps/server/src/config.ts`, `apps/server/src/index.ts`).

Credential values and gateway URL components are registered for redaction during load. New runtime settings belong in `KNOWN_KEYS`, typed configuration, `.env.example` and tests; do not log values. See [security](../security.md) and [data models](data-models.md).

## Key source files

| File                                         | Purpose                                                           |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `apps/server/src/config.ts`                  | File selection, recognized keys, defaults and secret registration |
| `apps/server/src/index.ts`                   | Packaging/repo discovery, web default and configured logger       |
| `apps/server/src/network/limits.ts`          | Download/read-ahead validation and units                          |
| `apps/server/src/playback/memoryWatchdog.ts` | Working-set defaults and sampling                                 |
| `.env.example`                               | Comment-only setup template, including tooling inputs             |
| `scripts/lib/dotenv.mjs`                     | Script-specific env-file overlay                                  |
| `apps/server/test/config.test.ts`            | Loader/precedence validation                                      |
| `apps/server/test/envExample.test.ts`        | Recognized-key/template drift check                               |
