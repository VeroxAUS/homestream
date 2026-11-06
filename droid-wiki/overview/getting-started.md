# Getting started

Use Node.js 24, pnpm 12, Git, FFmpeg, and ffprobe. Playback needs an NVIDIA GPU and an NVENC-enabled FFmpeg build; unit and integration tests do not (`README.md`, `.nvmrc`, `package.json`).

## Install and configure

From the repository root:

```powershell
node scripts/bootstrap.mjs
```

The bootstrap checks tools, installs dependencies and hooks, creates `.env` from `.env.example` only if absent, and builds shared contracts (`scripts/bootstrap.mjs`). A dev container is available in `.devcontainer/devcontainer.json`.

Set your own `GATEWAY_MANIFEST_URL` and `TMDB_READ_TOKEN` in `.env`. `TORBOX_API_KEY` is optional. Do not paste credentials or signed gateway URLs into issues or logs. The complete setting list is in `.env.example`; configuration loading is in `apps/server/src/config.ts`.

The default data and transcode locations are `E:\HomeStream\data` and `E:\HomeStream\transcode`. On Linux, or on a machine without that drive, explicitly set `DATA_DIR` and `TRANSCODE_DIR` to writable absolute paths. Set `FFMPEG_PATH` and `FFPROBE_PATH` if the binaries are not on PATH (`apps/server/src/config.ts`).

## Build and run

```powershell
pnpm build
pnpm --filter @homestream/server start
```

The API and built web assets are served on port 8600 by default. The API explorer is at `http://localhost:8600/api/docs`. The web page currently says that the UI is coming soon (`apps/web/src/App.tsx`); this is not a working browser playback screen.

For development, start the server and web app in separate terminals:

```powershell
pnpm --filter @homestream/server dev
pnpm --filter @homestream/web dev
```

Vite listens on port 8601 and proxies `/api` and `/hls` to port 8600 (`apps/web/vite.config.ts`). Missing upstream keys produce configuration warnings rather than preventing the process from starting (`apps/server/src/index.ts`).

## Safe checks

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:ci
```

`pnpm test:ci` runs offline unit and integration tests across the workspaces. GPU and live tiers are separate and must be run deliberately (`package.json`, `apps/server/package.json`). See [testing](../how-to-contribute/testing.md) for fixtures, resource rules, and coverage gates.

Use `GET /healthz` for process liveness, `GET /readyz` for local readiness, and `GET /api/health` for the dependency dashboard (`apps/server/src/routes/ops.ts`, `apps/server/src/routes/health.ts`). See [configuration](../reference/configuration.md) and [debugging](../how-to-contribute/debugging.md) when setup fails.
