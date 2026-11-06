# Apps

Active contributors: VeroxAUS

## Purpose

HomeStream has an implemented [server](server.md) and a [placeholder web app](web.md). The server owns metadata, upstream access, persistence and encoding; clients use the [shared contracts](../packages/shared.md) rather than calling upstream services directly (`apps/server/src/app.ts`, `apps/web/src/App.tsx`).

## Runtime boundaries

| Runtime              | Status and responsibility                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `@homestream/server` | Fastify API, HLS, SQLite, background services and optional built web assets; `apps/server/src/app.ts`                            |
| `@homestream/web`    | React 19/Vite scaffold showing a heading and coming-soon text; `apps/web/src/App.tsx`                                            |
| Desktop              | Planned Electron shell; `pnpm-workspace.yaml` reserves `apps/desktop`, but that directory has no implementation in this checkout |
| Google TV            | Planned Android TV client in `README.md`; no TV application workspace or implementation exists                                   |

The `tv`, `desktop` and `web` device kinds in `packages/shared/src/schemas.ts` are contract values, not proof of shipped clients. Devices record capabilities and activity, not user accounts or authentication.

## Integration and modification

`apps/server/src/index.ts` starts the source proxy and public listener, then health checks, download polling and discovery. Vite proxies `/api` and `/hls` during development; the server serves built assets in production (`apps/web/vite.config.ts`, `apps/server/src/routes/static.ts`). No browser catalog, player or session controls are wired up yet.

Start server composition changes in `apps/server/src/app.ts`, UI work in `apps/web/src/App.tsx`, and cross-runtime changes in `packages/shared/src/index.ts`. See [architecture](../overview/architecture.md) and [API](../api/index.md).

## Key source files

| File                           | Purpose                                           |
| ------------------------------ | ------------------------------------------------- |
| `pnpm-workspace.yaml`          | Implemented workspaces and reserved desktop entry |
| `apps/server/src/index.ts`     | Server process entry and shutdown                 |
| `apps/server/src/app.ts`       | Service construction and HTTP composition         |
| `apps/web/src/main.tsx`        | Browser mount                                     |
| `apps/web/src/App.tsx`         | Current placeholder UI                            |
| `packages/shared/src/index.ts` | Shared public exports                             |

## Measured scope

At this snapshot, `apps/` contains **132 production TypeScript/TSX source files** and **110 test files**, a **0.83 test-to-code file ratio**. Server contributes 130/109; web contributes 2/1. Source counts use tracked files under application `src/`, excluding `*.test.ts(x)`; test counts include tracked `*.test.ts(x)` throughout each app, including opt-in tiers and script tests. Helpers, fixtures, configs and build outputs are excluded. Default-branch history has **1 unique human author**, VeroxAUS; bots are excluded. File ratios are not coverage measurements.
