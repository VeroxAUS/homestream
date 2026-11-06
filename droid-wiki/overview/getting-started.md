# Getting started

Use Node.js 24, pnpm 12, and Git. Real playback also needs FFmpeg, ffprobe, and an NVIDIA GPU with NVENC support; offline tests do not (`README.md`, `.nvmrc`, `package.json`). Run commands from the repository root.

## Install

```powershell
node scripts/bootstrap.mjs
```

The bootstrap checks tools, installs locked dependencies and hooks, creates `.env` from `.env.example` only when absent, and builds shared contracts (`scripts/bootstrap.mjs`). A development container is available in `.devcontainer/devcontainer.json`.

Set your own `GATEWAY_MANIFEST_URL` and `TMDB_READ_TOKEN` in `.env`. `TORBOX_API_KEY` is optional. Never paste their values or signed URLs into issues or logs. All supported settings are listed in `.env.example`, with loading rules in `apps/server/src/config.ts`.

The default data and transcode directories use the Windows E: drive. On Linux or a machine without that drive, set `DATA_DIR` and `TRANSCODE_DIR` to writable absolute paths. Set `FFMPEG_PATH` and `FFPROBE_PATH` when the binaries are not on PATH (`apps/server/src/config.ts`).

## Build and run

```powershell
pnpm build
pnpm --filter @homestream/server start
```

Open `http://localhost:8600/` for the web UI and `http://localhost:8600/api/docs` for Swagger. Home, search, movie/show details, and Settings exist; playback and dashboard tabs are placeholders (`apps/web/src/App.tsx`, `apps/web/src/pages/PlayerPage.tsx`, `apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`).

For development, start these in separate terminals:

```powershell
pnpm --filter @homestream/server dev
pnpm --filter @homestream/web dev
```

Vite listens on 8601 and proxies `/api` and `/hls` to 8600 (`apps/web/vite.config.ts`). Missing upstream keys produce warnings rather than stopping server startup (`apps/server/src/index.ts`). Desktop support modules can be tested without downloading or launching Electron; there is no working shell to launch yet (`apps/desktop/README.md`).

## Check the installation

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:ci
```

These checks need no real upstream credentials or GPU. Browser e2e tests are separate and need a server build and Chromium; follow [testing](../how-to-contribute/testing.md), which also explains the opt-in GPU and live tiers (`package.json`, `apps/web/playwright.config.ts`).

Use `/healthz` for liveness, `/readyz` for local readiness, and `/api/health` for dependency health (`apps/server/src/routes/ops.ts`, `apps/server/src/routes/health.ts`). See [configuration](../reference/configuration.md) and [debugging](../how-to-contribute/debugging.md) for failures.
