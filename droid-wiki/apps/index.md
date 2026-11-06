# Apps

Active contributors: VeroxAUS

HomeStream has a working server, an early browser UI, and a desktop support package. Only the server owns upstream access, persistence, and encoding; clients use shared contracts (`apps/server/src/app.ts`, `pnpm-workspace.yaml`).

## Runtime boundaries

| App                   | Status and responsibility                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [Server](server.md)   | Fastify API, HLS, SQLite, background workers, and built web assets, `apps/server/src/index.ts`                        |
| [Web](web/index.md)   | Home, search, movie/show details, Settings, navigation, device identity, and download updates, `apps/web/src/App.tsx` |
| [Desktop](desktop.md) | Tested logging, request ID, and telemetry support modules; no actual Electron shell yet, `apps/desktop/src/index.ts`  |
| Google TV             | Planned only, no app implementation or workspace, `README.md`, `pnpm-workspace.yaml`                                  |

The browser player and dashboard tabs are placeholders. The intended desktop window/tray/supervisor/preload are not implemented (`apps/web/src/pages/PlayerPage.tsx`, `apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`, `apps/desktop/README.md`). Device kinds in `packages/shared/src/schemas.ts` do not imply shipped clients or authentication.

## Integration and modification

The server starts both listeners, background health/download work, and discovery in `apps/server/src/index.ts`. Vite proxies `/api` and `/hls` during development; production serves built UI assets with SPA fallback (`apps/web/vite.config.ts`, `apps/server/src/routes/static.ts`).

Start server composition changes in `apps/server/src/app.ts`, routes and UI work in `apps/web/src/App.tsx`, desktop support work in `apps/desktop/src/`, and wire-format changes in [shared contracts](../packages/shared.md). See [architecture](../overview/architecture.md) and [API](../api/index.md).

## Key source files

| File                           | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `pnpm-workspace.yaml`          | Four actual workspace packages              |
| `apps/server/src/index.ts`     | Server process startup and shutdown         |
| `apps/server/src/app.ts`       | Service and HTTP composition                |
| `apps/web/src/main.tsx`        | Browser mount and deferred startup work     |
| `apps/web/src/App.tsx`         | Lazy client routes                          |
| `apps/desktop/src/index.ts`    | Support-module exports, not a running shell |
| `packages/shared/src/index.ts` | Cross-runtime contracts                     |

## Measured scope

The three app source trees contain **198 TypeScript/TSX source files** excluding colocated test files; their app trees contain **139 test files**, a **0.70 test-to-code file ratio**. Source declarations are included; helpers outside source trees and non-test fixtures are not counted as tests. Physical file counts are not test coverage. [By the numbers](../by-the-numbers.md) gives repository-wide methods. Default-branch history has one unique human author; bot authors are excluded.
