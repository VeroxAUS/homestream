# Dependencies

This inventory describes direct manifest declarations at commit `7eb94bafed5e0e046987a81d0cbbff8e6ba999d1`, not installed/transitive package totals or a freshness audit. Four workspace packages are listed in `pnpm-workspace.yaml`; root `package.json` supplies shared tooling rather than a fifth workspace. See [architecture](../overview/architecture.md) and [tooling](../how-to-contribute/tooling.md).

## Counting method and totals

Count each key in `dependencies` and `devDependencies` once per manifest and group. Separate `workspace:*` runtime links from external registry runtime entries. “Unique” means the union of package **names**, ignoring version ranges and repeated declarations. Root tooling is included explicitly; none of these five manifests declares peer or optional dependencies (`package.json`, `apps/server/package.json`, `apps/web/package.json`, `apps/desktop/package.json`, `packages/shared/package.json`).

| Manifest                       | External runtime | Workspace runtime | Development | All declarations |
| ------------------------------ | ---------------: | ----------------: | ----------: | ---------------: |
| `package.json`                 |                0 |                 0 |          17 |               17 |
| `apps/server/package.json`     |               12 |                 1 |           1 |               14 |
| `apps/web/package.json`        |                6 |                 1 |          14 |               21 |
| `apps/desktop/package.json`    |                2 |                 1 |           3 |                6 |
| `packages/shared/package.json` |                1 |                 0 |           0 |                1 |
| **Total declarations**         |           **21** |             **3** |      **35** |           **59** |

There are **24 runtime declarations** including internal links, **56 external declarations**, **19 unique external runtime names**, and **33 unique development names**. The external runtime/development sets do not overlap, giving **52 unique external names**, or **53 names including `@homestream/shared`**. Repeated external runtime names are Zod (server/shared) and `posthog-node` (server/desktop); `@size-limit/file` and `size-limit` repeat in development (web/desktop). A workspace edge is not a registry download.

These are reproducible manifest metrics, not vulnerability, license, unused-package or package-age findings. `pnpm-lock.yaml` describes concrete resolutions and platform-specific/transitive packages, which are deliberately excluded from these counts.

## Production declarations

Ranges below are **manifest requests**, not claims about the latest registry release.

### Server

All entries below come from `apps/server/package.json`; the additional internal dependency is `@homestream/shared` `workspace:*`.

| Package               | Range      | Responsibility                            |
| --------------------- | ---------- | ----------------------------------------- |
| `fastify`             | `^5.12.8`  | HTTP runtime                              |
| `@fastify/cors`       | `^11.4.0`  | CORS                                      |
| `@fastify/rate-limit` | `^11.2.2`  | Scoped route rate limiting                |
| `@fastify/static`     | `^10.1.8`  | Built browser assets                      |
| `@fastify/swagger`    | `~9.9.3`   | OpenAPI generation                        |
| `@fastify/swagger-ui` | `~6.1.3`   | Local API reference UI                    |
| `@sentry/node`        | `~11.10.0` | Optional error reporting/manual telemetry |
| `bonjour-service`     | `^1.4.4`   | LAN mDNS discovery                        |
| `pino`                | `^10.4.0`  | Structured logging                        |
| `posthog-node`        | `~5.61.2`  | Optional analytics/flags                  |
| `prom-client`         | `~15.1.3`  | Prometheus metrics                        |
| `zod`                 | `^4.6.7`   | Runtime contracts                         |

The server has no native npm dependency: SQLite uses Node 24's built-in synchronous `node:sqlite`, not `better-sqlite3` or another addon (`apps/server/src/db/index.ts`, `apps/server/package.json`). FFmpeg/NVENC is a separate executable/driver boundary, not a JavaScript codec library. See [server](../apps/server.md) and [data models](data-models.md).

### Browser, desktop and shared

| Manifest                       | External runtime declarations                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/package.json`        | `react` `^19.3.1`, `react-dom` `^19.3.1`, `react-router` `^8.5.1`, `@tanstack/react-query` `^5.106.1`, `@sentry/react` `~11.10.0`, `posthog-js` `~1.446.3` |
| `apps/desktop/package.json`    | `@sentry/electron` `~8.3.0`, `posthog-node` `~5.61.2`                                                                                                      |
| `packages/shared/package.json` | `zod` `^4.6.7`                                                                                                                                             |

Both apps also link `@homestream/shared` with `workspace:*`. The browser has real routing/query/screen consumers, while the desktop package currently exports support modules rather than launching Electron (`apps/web/src/App.tsx`, `apps/web/src/api/queries.ts`, `apps/desktop/src/index.ts`). See [web](../apps/web/index.md), [desktop](../apps/desktop.md) and [shared](../packages/shared.md).

Sentry is **11.10** for server/browser and **8.3** for Electron; those different SDK families are intentional declarations, not evidence of accidental version drift. Runtime transmission remains optional and key-gated; installing a telemetry package does not enable reporting ([telemetry](../systems/telemetry.md)).

## Development declarations

The root's **17** tooling dependencies are declared in `package.json`:

| Group                            | Packages and manifest ranges                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Language/types                   | `typescript` `~6.0.3`, `@types/node` `^26.6.6`                                                                                     |
| Lint                             | `@eslint/js` `^10.0.1`, `eslint` `^10.14.0`, `typescript-eslint` `^8.72.1`, `eslint-plugin-sonarjs` `~4.2.2`, `globals` `^17.14.0` |
| Tests/coverage                   | `vitest` `^5.1.0`, `@vitest/coverage-v8` `~5.1.0`                                                                                  |
| Boundaries/dead code/duplication | `dependency-cruiser` `~18.7.2`, `knip` `~6.44.1`, `jscpd` `~5.4.2`                                                                 |
| Formatting/version consistency   | `prettier` `~3.9.10`, `syncpack` `~15.3.3`                                                                                         |
| Task graph/hooks/data            | `turbo` `~2.11.10`, `lefthook` `~2.2.2`, `yaml` `^2.9.1`                                                                           |

Workspace-specific development dependencies:

| Manifest                       | Declarations                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/package.json`     | `tsx` `^4.23.15`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/web/package.json`        | `@playwright/test` `~1.64.1`, `@sentry/vite-plugin` `~11.10.0`, `@size-limit/file` `~14.3.0`, `@testing-library/dom` `^10.4.2`, `@testing-library/jest-dom` `^7.0.1`, `@testing-library/react` `^16.3.3`, `@testing-library/user-event` `^14.6.8`, `@types/react` `^19.3.0`, `@types/react-dom` `^19.3.0`, `@vitejs/plugin-react` `^6.2.1`, `jsdom` `^31.0.0`, `rollup-plugin-visualizer` `^7.1.2`, `size-limit` `~14.3.0`, `vite` `^8.3.5` |
| `apps/desktop/package.json`    | `@size-limit/file` `~14.3.0`, `electron` `~45.2.3`, `size-limit` `~14.3.0`                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/shared/package.json` | None; uses shared root tools                                                                                                                                                                                                                                                                                                                                                                                                                |

Electron is a development declaration even though the eventual packaged desktop runtime needs its binary. The documented setup downloads that binary separately/lazily using `node apps/desktop/node_modules/electron/install.js`; set `ELECTRON_CACHE` first if its cache must live on another drive. Plain Node desktop tests do not launch or require the binary (`apps/desktop/README.md`). The dependency does not imply an implemented window/tray/supervisor.

## Resolution policy and non-npm dependencies

- `package.json` requires **Node >=24 <25** and selects **pnpm ^12.16.0** through `devEngines.packageManager`. The package-manager document in `pnpm-lock.yaml` resolves pnpm **12.18.0**; that is not an app declaration.
- `pnpm-workspace.yaml` permits install builds for `electron`, `esbuild`, `electron-winstaller` and `lefthook`, denies the `core-js` donation build, and overrides `glob@<14.0.2` to `14.0.2` and `minimatch@<11.0.1` to `11.0.1`. Build approval is not an inventory of direct dependencies.
- FFmpeg, ffprobe, NVIDIA drivers and `nvidia-smi` are host requirements, not npm declarations (`apps/server/src/health/checks/ffmpeg.ts`, `apps/server/src/health/checks/gpu.ts`).
- TMDB, gateway, upstream CDN, optional TorBox/Sentry/PostHog and an optional Prometheus scraper are service dependencies, not additional npm packages (`apps/server/src/app.ts`, `monitoring/prometheus/prometheus.yml`). See [configuration](configuration.md).

Update compatibility is governed by the repository's version-consistency, module-boundary, bundle and test gates, not by this inventory. No registry freshness, vulnerability or unused-dependency scan was performed for this page.
