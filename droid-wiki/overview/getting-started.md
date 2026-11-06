# Getting started

Use a recent Node.js release with `node:sqlite` and `node:util.parseEnv`, pnpm, and FFmpeg/ffprobe. The repository does not pin a Node version or package-manager version in `package.json`; verify those built-in APIs before installation.

## Install and configure

From the repository root:

```powershell
pnpm install
pnpm --filter @homestream/shared build
```

Create a local `.env` with your own values for `GATEWAY_MANIFEST_URL` and `TMDB_READ_TOKEN`. `TORBOX_API_KEY` is optional. Never commit credentials or token-bearing gateway URLs. `apps/server/src/config.ts` defines recognized variables and configuration precedence.

Set `DATA_DIR` and `TRANSCODE_DIR` to writable locations if the Windows defaults `D:\HomeStream\data` and `D:\HomeStream\transcode` do not suit your machine. Set `FFMPEG_PATH` and `FFPROBE_PATH` when the executables are not on PATH. Encoding requirements depend on the FFmpeg build and available hardware; see [encoding](../systems/playback/encoding.md).

## Development

Run in separate terminals:

```powershell
pnpm --filter @homestream/server dev
pnpm --filter @homestream/web dev
```

The server defaults to port 8600 (`apps/server/src/config.ts`). Vite uses port 8601 and proxies `/api` and `/hls` to `127.0.0.1:8600` (`apps/web/vite.config.ts`). The web page is currently a placeholder, not a playback client (`apps/web/src/App.tsx`).

## Build and run

```powershell
pnpm build
pnpm --filter @homestream/server start
```

Root scripts recurse across present workspaces (`package.json`). The server build builds shared contracts before compiling; production startup uses `apps/server/dist/index.js` (`apps/server/package.json`). Startup looks for the built web assets at `apps/web/dist` by default (`apps/server/src/index.ts`).

## Checks

```powershell
pnpm typecheck
pnpm lint
pnpm test
```

Some tests require real FFmpeg, hardware support, or configured live services. Live tests are included by the current server test configuration, so a full test run can make external requests. Read [testing](../how-to-contribute/testing.md) before running the complete suite. This documentation run validates wiki structure separately and does not imply these application checks passed.

See [configuration](../reference/configuration.md) for file discovery and defaults, and [debugging](../how-to-contribute/debugging.md) for startup failures.
