# Dependencies

These counts describe direct declarations in the root plus three present workspace manifests at `bb48e6d`, not the transitive lockfile graph. Runtime registry packages, workspace links and development tools are counted separately. See [architecture](../overview/architecture.md) for boundaries and [tooling](../how-to-contribute/tooling.md) for checks.

## Declaration counts

| Manifest                       | Registry runtime | Workspace runtime | Registry development | All declarations |
| ------------------------------ | ---------------: | ----------------: | -------------------: | ---------------: |
| `package.json`                 |                0 |                 0 |                   17 |               17 |
| `apps/server/package.json`     |               12 |                 1 |                    1 |               14 |
| `apps/web/package.json`        |                2 |                 1 |                    4 |                7 |
| `packages/shared/package.json` |                1 |                 0 |                    0 |                1 |
| **Total declarations**         |           **15** |             **2** |               **22** |           **39** |

Thus runtime has **17 declarations** including the two workspace edges. Registry declarations total **37**, with **36 distinct external package names**: **14 runtime names** and **22 development names**, with no cross-group overlap. Zod is the one repeated runtime registry name. The two workspace declarations share the one name `@homestream/shared`; including it gives **37 unique dependency names** overall. None of these manifests declares peer or optional dependencies.

These are counts of manifest groups, not installed package count, licenses or vulnerability findings. The reserved desktop workspace and Electron build allowlist do not add dependencies without a manifest (`pnpm-workspace.yaml`).

## Registry runtime packages

| Package               | Manifest range | Runtime responsibility                  |
| --------------------- | -------------- | --------------------------------------- |
| `@fastify/cors`       | `^11.4.0`      | Server CORS                             |
| `@fastify/rate-limit` | `^11.2.2`      | Scoped readiness throttling             |
| `@fastify/static`     | `^10.1.8`      | Optional built web assets               |
| `@fastify/swagger`    | `~9.9.3`       | OpenAPI generation                      |
| `@fastify/swagger-ui` | `~6.1.3`       | Local API documentation                 |
| `@sentry/node`        | `~11.10.0`     | Optional server errors/manual telemetry |
| `bonjour-service`     | `^1.4.4`       | mDNS discovery                          |
| `fastify`             | `^5.12.8`      | HTTP runtime                            |
| `pino`                | `^10.4.0`      | Structured local logging                |
| `posthog-node`        | `~5.61.2`      | Optional analytics and remote flags     |
| `prom-client`         | `~15.1.3`      | Prometheus registry/process collectors  |
| `zod`                 | `^4.6.7`       | Server/shared runtime contracts         |
| `react`               | `^19.3.1`      | Web scaffold                            |
| `react-dom`           | `^19.3.1`      | Browser rendering                       |

Sources are `apps/server/package.json`, `apps/web/package.json` and `packages/shared/package.json`. Server and web link `@homestream/shared` with `workspace:*`; that internal link is not a registry download. Shared's only runtime dependency is Zod.

## Development packages

The **17** root declarations in `package.json` are:

| Group                            | Packages and manifest ranges                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Language/types                   | `typescript` `~6.0.3`, `@types/node` `^26.6.6`                                                                                     |
| Lint                             | `@eslint/js` `^10.0.1`, `eslint` `^10.14.0`, `typescript-eslint` `^8.72.1`, `eslint-plugin-sonarjs` `~4.2.2`, `globals` `^17.14.0` |
| Tests/coverage                   | `vitest` `^5.1.0`, `@vitest/coverage-v8` `~5.1.0`                                                                                  |
| Boundaries/dead code/duplication | `dependency-cruiser` `~18.7.2`, `knip` `~6.44.1`, `jscpd` `~5.4.2`                                                                 |
| Formatting/version consistency   | `prettier` `~3.9.10`, `syncpack` `~15.3.3`                                                                                         |
| Task graph/hooks/data            | `turbo` `~2.11.10`, `lefthook` `~2.2.2`, `yaml` `^2.9.1`                                                                           |

`apps/server/package.json` adds `tsx` `^4.23.15`. `apps/web/package.json` adds `@types/react` `^19.3.0`, `@types/react-dom` `^19.3.0`, `@vitejs/plugin-react` `^6.2.1` and `vite` `^8.3.5`. Shared has no separate development declarations and uses workspace tools.

## Resolution, external executables and services

`package.json` requires **Node >=24 <25** and `devEngines.packageManager` selects **pnpm ^12.16.0**; `.nvmrc` selects Node 24. `pnpm-lock.yaml` records concrete application resolutions and a separate package-manager document resolving pnpm **12.18.0**. That manager entry is not an application runtime/development declaration.

`pnpm-workspace.yaml` overrides `glob@<14.0.2` to `14.0.2` and `minimatch@<11.0.1` to `11.0.1`. It permits install builds for Electron, esbuild, electron-winstaller and lefthook; allowlisting a build does not mean that package is a direct server dependency.

SQLite is built into Node (`node:sqlite`), not a native npm addon (`apps/server/src/db/index.ts`). FFmpeg, ffprobe and `nvidia-smi`/NVIDIA drivers are machine dependencies rather than manifest entries (`apps/server/src/health/checks/ffmpeg.ts`, `apps/server/src/health/checks/gpu.ts`).

TMDB, the configured gateway, upstream media CDN, optional TorBox, optional Sentry and optional PostHog are remote integration dependencies, not additional npm declarations. Prometheus is an optional external scraper. Credentials and endpoints are in [configuration](configuration.md); outbound privacy and default no-op behavior are in [telemetry](../systems/telemetry.md).

Do not label versions stale or safe from this inventory alone. Dependency updates must preserve runtime/tool compatibility and pass the repository checks.

## Key source files

| File                           | Purpose                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `package.json`                 | Root tooling declarations, scripts and engine constraints |
| `apps/server/package.json`     | Twelve registry runtime dependencies plus shared link     |
| `apps/web/package.json`        | React runtime and Vite tooling                            |
| `packages/shared/package.json` | Shared ESM/declaration exports and Zod                    |
| `pnpm-workspace.yaml`          | Workspace discovery, build approvals and overrides        |
| `pnpm-lock.yaml`               | Resolved graph and package-manager resolution             |
| `.nvmrc`                       | Node major selection                                      |
| `apps/server/src/db/index.ts`  | Built-in SQLite dependency boundary                       |
