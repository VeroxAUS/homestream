# Dependencies

This inventory separates direct manifest declarations from resolved lockfile records at **`0a8f04fd81cfaa7ca5d1689550ad207e7fc0d3ae`**, counted **2026-11-08**. Four workspaces are listed in `pnpm-workspace.yaml`; root `package.json` supplies tooling. Versions below are local requests/resolutions, not a freshness or vulnerability assessment.

## Counts

Each manifest key is counted once per dependency group across five manifests, without expanding the graph. Workspace links are separate from external runtime dependencies; none of these manifests declares peer or optional dependencies.

| Manifest                       | External runtime | Workspace runtime | Development |  Total |
| ------------------------------ | ---------------: | ----------------: | ----------: | -----: |
| `package.json`                 |                0 |                 0 |          17 |     17 |
| `apps/server/package.json`     |               12 |                 1 |           1 |     14 |
| `apps/web/package.json`        |                7 |                 1 |          14 |     22 |
| `apps/desktop/package.json`    |                2 |                 1 |           3 |      6 |
| `packages/shared/package.json` |                1 |                 0 |           0 |      1 |
| **Total declarations**         |           **22** |             **3** |      **35** | **60** |

There are **57 external declarations** plus **3 workspace declarations**. Deduplicating names gives **20 external runtime names**, **33 development names** and **53 external names overall**, with no runtime/development name overlap; including `@homestream/shared` gives **54 names**.

Deduplicating **`(name, requested specifier)` pairs** also gives **53 external / 54 including workspace** because repeated packages request identical ranges. Deduplicating only external specifier strings gives **48**; that is a range-string count, not a package count or installed-version count. Repeated names are Zod, `posthog-node`, `@size-limit/file` and `size-limit` (`package.json`, `apps/server/package.json`, `apps/web/package.json`, `apps/desktop/package.json`, `packages/shared/package.json`).

## Lockfile resolution

`pnpm-lock.yaml` is a **two-document YAML stream**, so counting only its first `packages` map misses the application graph. It was parsed with the already-declared `yaml` library's `parseAllDocuments`, not line counts or an installed `node_modules` inventory.

| Lockfile document/scope                 | `packages` records | Distinct package names | Meaning                                                                                     |
| --------------------------------------- | -----------------: | ---------------------: | ------------------------------------------------------------------------------------------- |
| First, package-manager graph            |                 15 |                     15 | pnpm 12.18.0 plus its platform executable packages                                          |
| Second, root + four workspace importers |                593 |                    540 | Direct and transitive application/tooling resolutions, including platform/optional packages |
| Union of both documents                 |                608 |                    555 | Distinct resolved name/version keys across the whole committed stream                       |

Both documents also have respectively **15 / 593 `snapshots`** entries. In the second document, **53 distinct package records** are directly referenced by external dependency/development entries in its five importers; **540 records** are not directly referenced and are transitive-only under that definition. These 540 records are not the same measure as the 540 distinct names across the whole second document.

Method: count `Object.keys(document.packages)`, strip the final `@version` part for name deduplication, and normalize importer resolutions by removing peer-context suffixes in parentheses before comparing `name@version` keys. Exclude `link:` workspace resolutions from direct external references; all 53 normalized direct keys exist in the second `packages` map. Lockfile records describe all resolved platforms, not 608 packages necessarily installed or bundled on this machine.

## Runtime libraries

| Workspace | Main declarations and requested ranges                                                                           | Role                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Server    | Fastify `^5.12.8`, CORS `^11.4.0`, rate-limit `^11.2.2`, static `^10.1.8`, Swagger `~9.9.3`, Swagger UI `~6.1.3` | HTTP and API documentation                   |
| Server    | Pino `^10.4.0`, `prom-client` `~15.1.3`, Bonjour `^1.4.4`                                                        | Logging, metrics, LAN discovery              |
| Server    | `@sentry/node` `~11.10.0`, `posthog-node` `~5.61.2`, Zod `^4.6.7`                                                | Optional telemetry and validation            |
| Web       | React/React DOM `^19.3.1`, React Router `^8.5.1`, TanStack Query `^5.106.1`                                      | Rendering, navigation and server-state cache |
| Web       | `hls.js` `^1.7.4`                                                                                                | Lazy-loaded browser HLS playback             |
| Web       | `@sentry/react` `~11.10.0`, `posthog-js` `~1.446.3`                                                              | Optional lazy telemetry                      |
| Desktop   | `@sentry/electron` `~8.3.0`, `posthog-node` `~5.61.2`                                                            | Main-process telemetry                       |
| Shared    | Zod `^4.6.7`                                                                                                     | Runtime contracts and inferred types         |

Ranges are manifest requests, not claims about latest releases. Source manifests are `apps/server/package.json`, `apps/web/package.json`, `apps/desktop/package.json`, and `packages/shared/package.json`. Every app also imports internal shared contracts.

SQLite, filesystem/process primitives, and server fetch come from Node, not native database/fetch npm modules (`apps/server/src/db/index.ts`, `apps/server/src/app.ts`).

## Toolchain

Root tooling includes TypeScript `~6.0.3`, ESLint `^10.14.0`, typescript-eslint `^8.72.1`, Prettier `~3.9.10`, Vitest `^5.1.0`, Turbo `~2.11.10`, Knip `~6.44.1`, dependency-cruiser `~18.7.2`, jscpd `~5.4.2`, Syncpack `~15.3.3`, and Lefthook `~2.2.2` (`package.json`).

Web development uses Vite `^8.3.5`, Testing Library, jsdom, Playwright `~1.64.1`, a bundle visualizer and size-limit. Server development adds tsx. Desktop declares Electron `~45.2.3` as a development dependency and uses its binary at runtime (`apps/web/package.json`, `apps/server/package.json`, `apps/desktop/package.json`). Its binary is downloaded separately; tests do not generally start it. See [desktop](../apps/desktop/index.md) and [testing](../how-to-contribute/testing.md).

## Resolution and host dependencies

Node `>=24 <25` and pnpm `^12.16.0` are selected by root engine metadata, without a `packageManager` field. CI pins pnpm 12.18.0 (`package.json`, `.github/workflows/ci.yml`).

`pnpm-workspace.yaml` permits builds for Electron, esbuild, electron-winstaller and Lefthook, denies the core-js donation script, and overrides older glob/minimatch resolutions. Build approval is not proof that each package is directly declared.

Real playback depends on FFmpeg, ffprobe and NVIDIA drivers; GPU health uses `nvidia-smi`. TMDB, the gateway, upstream CDN, optional TorBox, Sentry/PostHog, and a Prometheus scraper are service dependencies, not npm entries (`apps/server/src/app.ts`, `monitoring/prometheus/prometheus.yml`).

Use the lockfile and repository gates when updating dependencies. This generation did not query registry freshness or run a vulnerability audit. See [tooling](../how-to-contribute/tooling.md), [architecture](../overview/architecture.md), and [configuration](configuration.md).

## Import boundaries

`.dependency-cruiser.cjs` rejects cycles, unresolved imports, app imports from shared, production imports from test helpers, client imports from server, server imports from clients and web/desktop imports of each other. Apps share contracts through `@homestream/shared`, not implementation imports. `pnpm deps:check` enforces these rules; `pnpm syncpack:lint` checks declaration-version consistency (`package.json`). See [shared contracts](../packages/shared.md).
