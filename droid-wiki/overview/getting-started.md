# Getting started

Use Node.js 24, pnpm 12, and Git. Real playback also needs FFmpeg, ffprobe, and an NVIDIA GPU with NVENC support. Offline unit and integration tests need no GPU or upstream credentials (`README.md`, `.nvmrc`, `package.json`). Run commands from the repository root.

## Install

```powershell
node scripts/bootstrap.mjs
```

Bootstrap checks tools, installs locked dependencies and hooks, creates `.env` from `.env.example` only when absent, and builds shared contracts (`scripts/bootstrap.mjs`). A development container is available in `.devcontainer/devcontainer.json`.

Set your own `GATEWAY_MANIFEST_URL` and `TMDB_READ_TOKEN` in `.env`. `TORBOX_API_KEY` is optional. Never paste secrets or signed URLs into logs or issues. Supported settings and loading rules are in `.env.example` and `apps/server/src/config.ts`.

Default data and transcode directories target a Windows drive. On Linux or a machine without that drive, set `DATA_DIR` and `TRANSCODE_DIR` to writable absolute paths. Set `FFMPEG_PATH` and `FFPROBE_PATH` if needed (`apps/server/src/config.ts`).

## Build and run

```powershell
pnpm build
pnpm --filter @homestream/server start
```

Open `http://localhost:8600/` for the UI and `http://localhost:8600/api/docs` for Swagger. Browsing, search, details, playback, and Settings exist; dashboard tabs are still placeholders (`apps/web/src/App.tsx`, `apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`).

For development, start these in separate terminals:

```powershell
pnpm --filter @homestream/server dev
pnpm --filter @homestream/web dev
```

Vite listens on 8601 and proxies `/api` and `/hls` to 8600 (`apps/web/vite.config.ts`). Missing upstream keys produce warnings rather than blocking startup (`apps/server/src/index.ts`).

## Desktop shell

Build the server, web, and desktop workspaces with `pnpm build`, then run:

```powershell
pnpm --filter @homestream/desktop start
```

The Electron binary is installed separately. Keep `ELECTRON_CACHE` on a suitable drive and follow the installation command in `apps/desktop/README.md`. The launcher rejects a missing binary or unbuilt shell; the shell opens the same server-hosted UI and can start or attach to a server (`apps/desktop/scripts/start.mjs`, `apps/desktop/src/main.ts`, `apps/desktop/src/supervisor.ts`). See [desktop](../apps/desktop/index.md).

## Check the installation

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:ci
```

Browser e2e tests are separate and need a server build and Chromium. Desktop unit tests do not start Electron; its launch smoke test does. See [testing](../how-to-contribute/testing.md) for exact scopes and opt-in GPU/live procedures (`apps/server/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/desktop/vitest.smoke.config.ts`).

Use `/healthz` for liveness, `/readyz` for local readiness, and `/api/health` for dependency health (`apps/server/src/routes/ops.ts`, `apps/server/src/routes/health.ts`). See [configuration](../reference/configuration.md) and [debugging](../how-to-contribute/debugging.md) for failures.
