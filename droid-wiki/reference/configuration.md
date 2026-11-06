# Configuration

`apps/server/src/config.ts` loads a single env-format file plus process overrides. Changes take effect on restart. See [getting started](../overview/getting-started.md) for setup without exposing credentials.

## File selection and precedence

1. A nonblank process `HOMESTREAM_ENV_FILE` selects that path, even if it does not exist; no fallback file is then selected.
2. Otherwise, an existing repository-root `.env` wins when a repository root is supplied.
3. Otherwise, an existing `%APPDATA%\HomeStream\config.env` wins. If APPDATA is blank, the base is the home directory's `AppData\Roaming`.
4. If neither exists, the intended path is repository `.env` when a root is available, otherwise the app-data path.

Only that selected file is read, using Node `parseEnv`. Unreadable files add warnings. For each recognized key, trimmed nonblank process values override trimmed nonblank file values; blank process values do not erase file values.

`apps/server/src/index.ts` discovers the repository through `pnpm-workspace.yaml`; process `HOMESTREAM_PACKAGED=1` suppresses that discovery. Neither selector is a normal value loaded from the selected config file.

## Recognized values

| Key | Default / behavior |
| --- | --- |
| `GATEWAY_MANIFEST_URL` | Required for gateway use; missing becomes null |
| `TMDB_READ_TOKEN` | Required for TMDB use; missing becomes null |
| `TORBOX_API_KEY` | Optional, null |
| `PORT` | 8600; integer 0–65535, zero selects an ephemeral port |
| `SOURCE_PROXY_PORT` | Public port + 50; zero for ephemeral; public zero also defaults proxy to zero |
| `DATA_DIR` | `D:\HomeStream\data` |
| `TRANSCODE_DIR` | `D:\HomeStream\transcode` |
| `TRANSCODE_MAX_GB` | 20; positive finite number, used as GiB by playback |
| `FFMPEG_PATH` | `ffmpeg` |
| `FFPROBE_PATH` | `ffprobe` |
| `SERVER_NAME` | `HomeStream on <hostname>` |
| `HOMESTREAM_WEB_DIR` | Caller-provided default web directory, otherwise null |

Startup supplies `apps/web/dist` as the web default. The public host is fixed at `0.0.0.0`; there is no recognized HOST or LOG_LEVEL setting.

Invalid port/size inputs warn and use defaults. An overflowing derived proxy port becomes zero. The loopback proxy can also fall back to a free port if its chosen port is occupied. Missing required values populate `missingKeys` and warn at startup; they do not prevent the listener opening.

Credentials are registered for redaction during loading. Do not commit tokens or token-bearing manifest URLs. See [security](../security.md) and [debugging](../how-to-contribute/debugging.md).
