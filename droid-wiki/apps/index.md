# Apps

Active contributors: VeroxAUS

## Purpose

HomeStream ships a server, a browser client and an Electron shell. The server owns upstream credentials, SQLite and video encoding; clients consume shared contracts rather than importing server internals (`apps/server/src/app.ts`, `packages/shared/src/index.ts`).

## Runtime layout

| Runtime | Responsibility |
| --- | --- |
| [Server](server.md) | Fastify API, SSE, HLS, workers and optional built web assets; `apps/server/src/index.ts` |
| [Web](web/index.md) | Catalog, search, details, settings, implemented HLS playback and desktop renderer views; `apps/web/src/App.tsx` |
| [Desktop](desktop/index.md) | Implemented Electron tray/window shell, server supervision, mini player and preload IPC; `apps/desktop/src/main.ts`. |
| Google TV | Planned; no TV source workspace in `pnpm-workspace.yaml`. |

Only dashboard tabs remain placeholders, through `apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`. The browser player is implemented in `apps/web/src/pages/PlayerPage.tsx`; it is not a placeholder.

## Control flow and boundaries

The public listener serves API/media requests and built browser assets; a separate loopback proxy feeds source bytes to ffprobe/FFmpeg (`apps/server/src/index.ts`, `apps/server/src/sourceproxy/proxy.ts`). Vite proxies API/HLS during development (`apps/web/vite.config.ts`). Desktop wraps the web renderer and supervises or attaches to a server, rather than encoding in the renderer.

For wire changes, start in [shared contracts](../packages/shared.md). For a service dependency, start in `apps/server/src/app.ts`; for a screen, start in `apps/web/src/App.tsx`. See [architecture](../overview/architecture.md) and [conventions](../how-to-contribute/patterns-and-conventions.md).

## Key source files

| File | Purpose |
| --- | --- |
| `pnpm-workspace.yaml` | Actual workspaces |
| `apps/server/src/index.ts` | Process startup |
| `apps/server/src/app.ts` | Service composition |
| `apps/web/src/App.tsx` | Client route tree |
| `apps/desktop/src/main.ts` | Desktop entry |
| `packages/shared/src/index.ts` | Cross-runtime exports |

## Measured scope

At `5eefa37`, committed app source trees contain **290 non-test TypeScript/TSX files**, including declarations; app trees contain **208 `*.test.ts(x)` files**, ratio **208/290 = 0.72**. Method: filter `git ls-files` for `apps/*/src/` source and all app test filenames; exclude helpers/configs from tests. Default-branch history/CODEOWNERS identify **1 unique human author**, excluding bots. File ratios are not coverage or executed-test results.
