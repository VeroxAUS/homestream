# Server

Active contributors: VeroxAUS

## Purpose

The server is the LAN runtime for HTTP, SSE, HLS, persistence, upstream access and encoding. `buildApp` in `apps/server/src/app.ts` constructs the dependency graph; process startup in `apps/server/src/index.ts` owns listener and worker activation.

## Layout and abstractions

`AppContext` in `apps/server/src/context.ts` exposes one shared set of services. HTTP adapters live under `apps/server/src/routes/`; domain rules live under `apps/server/src/playback/`, `apps/server/src/streams/`, `apps/server/src/downloads/` and their neighboring service directories.

| Layer | Responsibility |
| --- | --- |
| Composition | Configuration, SQLite, event bus, telemetry and metrics |
| Discovery | TMDB metadata and gateway stream lookup |
| Media | Shared source proxy, playback facade, encoder/subtitle workers |
| Product state | Downloads, progress, Home and history |
| Operations | Health, request observability, OpenAPI and static hosting |

See [systems](../systems/index.md) and [features](../features/index.md) for implementation detail instead of placing domain logic in handlers.

## Startup and shutdown

`apps/server/src/index.ts` loads settings, creates the data directory/logger, records configuration warnings, builds the app and recovers encoder orphans. It starts the loopback source proxy before the public listener, then health/download scheduling, startup telemetry and optional mDNS. Missing upstream credentials warn but do not by themselves prevent listening.

`loadConfig` in `apps/server/src/config.ts` handles environment/file precedence and secret registration. Default public port is 8600; the proxy normally uses public port plus 50. See [configuration](../reference/configuration.md).

Building the app alone does not start periodic health/download workers. Injection seams in `apps/server/src/app.ts` replace upstreams, database, telemetry, probes, encoders, clocks and limits for isolated tests.

The close hook stops health/download scheduling, awaits playback then proxy cleanup, and closes resources only when it created them. Injected gateway/database/telemetry/logger ownership remains with the caller. Prefetch has an idle helper but is not explicitly awaited by this close hook.

`createShutdown` in `apps/server/src/shutdown.ts` coalesces shutdown and bounds cleanup. Signals, IPC shutdown and stdin shutdown converge on it. Discovery goodbye precedes app close (`apps/server/src/discovery.ts`).

## HTTP integration

The app registers catalog, streams, sessions/HLS, downloads, devices, progress, history, prefetch, events, health and operations routes (`apps/server/src/app.ts`). Shared schemas validate wire inputs. Expected application errors retain their redacted status/envelope; unexpected failures become generic 500 responses with optional error telemetry.

Request IDs are generated/sanitized through `apps/server/src/http/observability.ts`. CORS permits any origin, which is not authentication. This is a LAN service without accounts.

`registerStatic` in `apps/server/src/routes/static.ts` serves built assets only when an index document exists. SPA fallback excludes API/HLS paths and missing file-like paths. Empty JSON compatibility remains separate from nonempty-body validation (`apps/server/src/http/emptyJsonBody.ts`).

The [web player](web/index.md) and Electron shell are implemented clients; their dashboard placeholder does not imply missing playback APIs.

## Modification entry points

Add dependencies in `apps/server/src/app.ts` and `apps/server/src/context.ts`; change process startup in `apps/server/src/index.ts`. New routes require shared schemas and regenerated API documentation; follow [API](../api/index.md) and [conventions](../how-to-contribute/patterns-and-conventions.md).

## Key source files

| File | Purpose |
| --- | --- |
| `apps/server/src/app.ts` | Composition, HTTP and resource cleanup |
| `apps/server/src/index.ts` | Startup/workers/shutdown wiring |
| `apps/server/src/context.ts` | Typed dependency graph |
| `apps/server/src/config.ts` | Settings and secrets |
| `apps/server/src/shutdown.ts` | Bounded shutdown |
| `apps/server/src/discovery.ts` | mDNS |
| `apps/server/src/routes/static.ts` | UI hosting |

## Measured scope

At `5eefa37`, `git ls-files` yields **149 `.ts` source files** under `apps/server/src/` and **153 `*.test.ts` files** under `apps/server/`: **1.03 tests/source**. Includes integration/GPU/live/script test files; excludes fixtures/helpers/configs. Default-branch history/CODEOWNERS identify **1 unique human author**, excluding bots. No application or upstream validation was run for this page.
