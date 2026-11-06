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

## All 26 server keys

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

## Tooling keys are a different surface

`.env.example` includes more than server `KNOWN_KEYS`; do not add them to the runtime settings table by implication.

| Key/input                           | Consumer                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_ORG`, `SENTRY_API_TOKEN`    | Personal-token Sentry alert management (`scripts/sentry-alerts.mjs`); issue sync also needs them                      |
| `SENTRY_AUTH_TOKEN`                 | CI Sentry releases, distinct from the personal token (`.github/workflows/release.yml`)                                |
| `SENTRY_DSN_WEB`, `SENTRY_DSN_TV`   | Reserved client project configuration; not read by the current server loader and not proof of initialized client SDKs |
| `POSTHOG_PERSONAL_API_KEY`          | Flag creation tooling (`scripts/flags.mjs`), not event ingestion                                                      |
| `GITHUB_TOKEN`, `GITHUB_REPOSITORY` | Issue sync process environment (`scripts/sentry-issues.mjs`)                                                          |
| `HOMESTREAM_TEST_ROOT`              | Test temp-directory selection (`apps/server/test/helpers.ts`)                                                         |
| `GITLEAKS_PATH`                     | Pre-commit scanner executable selection (`scripts/pre-commit-secrets.mjs`)                                            |

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
