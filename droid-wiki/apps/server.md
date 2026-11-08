# Server

Active contributors: VeroxAUS

The Node 24/Fastify 5 server owns LAN HTTP, SSE, HLS, SQLite and media-tool processes. `buildApp` in `apps/server/src/app.ts` composes services; `main` in `apps/server/src/index.ts` activates listeners and background work.

## Purpose

Clients browse and control playback, but the PC resolves upstream sources and always re-encodes video. There are devices, not accounts; permissive CORS is not authentication. Keep the service on a trusted LAN. See [architecture](../overview/architecture.md), [API](../api/index.md) and [security](../security.md).

## Layout and abstractions

`AppContext` in `apps/server/src/context.ts` is the route-facing dependency graph.

| Area                                                                                   | Responsibility and related page                                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server/src/routes/`                                                              | Thin validation/HTTP adapters; [API](../api/index.md)                                                                          |
| `apps/server/src/tmdb/`, `apps/server/src/home/`                                       | [Catalog](../features/catalog.md)                                                                                              |
| `apps/server/src/gateway/`, `apps/server/src/streams/`                                 | Discovery and [selection](../features/stream-selection.md)                                                                     |
| `apps/server/src/playback/`                                                            | [Sessions, encoders and HLS](../systems/playback/index.md)                                                                     |
| `apps/server/src/sourceproxy/`, `apps/server/src/network/`                             | Shared ranged bytes and [network controls](../systems/network.md)                                                              |
| `apps/server/src/downloads/`, `apps/server/src/prefetch/`, `apps/server/src/progress/` | [Downloads](../features/downloads.md), [prefetch](../features/prefetch.md) and [resume state](../features/viewing-progress.md) |
| `apps/server/src/db/`, `apps/server/src/events/`                                       | Durable [models](../reference/data-models.md), events and SSE                                                                  |
| `apps/server/src/health/`, `apps/server/src/metrics/`, `apps/server/src/telemetry/`    | [Health](../systems/health.md), local metrics and optional [telemetry](../systems/telemetry.md)                                |

Composition shares a gateway client, source proxy, database and event bus rather than recreating them per request. `BuildAppOptions` in `apps/server/src/app.ts` injects upstream clients, probes, encoders, telemetry, clocks and limits for isolated tests.

## Startup and shutdown

```mermaid
graph LR
    Config[Load settings and logger] --> Build[Build app and services]
    Build --> Orphans[Recover recorded orphans]
    Orphans --> Proxy[Open loopback proxy]
    Proxy --> HTTP[Open LAN listener]
    HTTP --> Workers[Start health and downloads]
    Workers --> Discovery[Advertise mDNS if enabled]
    Discovery --> Stop[Signal or supervisor stop]
    Stop --> Goodbye[Discovery goodbye]
    Goodbye --> Close[Close app and logger]
```

`loadConfig` in `apps/server/src/config.ts` selects an env-format file, overlays recognized nonblank process settings, validates defaults and registers secrets for redaction. Missing gateway/TMDB credentials produce warnings, not an automatic listener refusal. Public HTTP defaults to port **8600** on `0.0.0.0`; the loopback proxy defaults to public port +50 and can choose a free port. Refer to [configuration](../reference/configuration.md), not copied settings lists.

Building an app does not start periodic health/download workers. Playback housekeeping starts when a session is registered. `startDiscovery` in `apps/server/src/discovery.ts` advertises `_homestream._tcp`; it uses the same filtered IPv4 list as `/api/info`, including the virtual-only fallback described in [network controls](../systems/network.md).

SSE connections end in the pre-close hook in `apps/server/src/routes/events.ts` so HTTP close need not wait forever for them. The app close hook stops health/download scheduling, awaits playback then proxy cleanup, and closes only the gateway/database/telemetry/logger resources it created. Injected resources remain caller-owned. It does not explicitly await prefetch's idle helper.

`createShutdown` in `apps/server/src/shutdown.ts` coalesces signals, IPC and stdin stop requests under an **eight-second process deadline**. Discovery goodbye precedes app close. This deadline can end the process before every bounded child-stop retry completes; next-start orphan recovery is a separate safety net.

## HTTP integration

Shared Zod schemas validate inputs. `AppError` and `errorBody` in `apps/server/src/errors.ts` preserve expected status codes and redact messages/hints; unexpected failures return a generic 500 and optionally report telemetry. Request correlation is installed by `registerRequestObservability` in `apps/server/src/http/observability.ts`.

`registerStatic` in `apps/server/src/routes/static.ts` serves a built UI only when its index exists. Hashed assets are immutable for a year; other files revalidate; precompressed assets are supported. SPA fallback is GET/HEAD-only and excludes API/HLS and missing file-like paths. Empty-JSON compatibility is isolated in `apps/server/src/http/emptyJsonBody.ts`.

`SERVER_VERSION` in `apps/server/src/version.ts` reads the package manifest relative to source/build root, falling back to `0.0.0`. The [web app](web/index.md) and [desktop shell](desktop/index.md) consume the implemented backend; dashboard placeholders are not missing playback services.

## Modification entry points

Wire services in `apps/server/src/app.ts` and `apps/server/src/context.ts`; change process activation in `apps/server/src/index.ts`. Keep domain behavior in its owning [system](../systems/index.md) or [feature](../features/index.md), and API shape in [shared contracts](../packages/shared.md).

## Key source files

| File                                       | Purpose                                          |
| ------------------------------------------ | ------------------------------------------------ |
| `apps/server/src/app.ts`                   | Composition, adapters and owned-resource cleanup |
| `apps/server/src/index.ts`                 | Startup and process shutdown wiring              |
| `apps/server/src/context.ts`               | Typed service graph                              |
| `apps/server/src/config.ts`                | Configuration and secret registration            |
| `apps/server/src/shutdown.ts`              | Coalesced bounded shutdown                       |
| `apps/server/src/discovery.ts`             | Best-effort mDNS publication                     |
| `apps/server/src/routes/static.ts`         | Built UI delivery                                |
| `apps/server/test/integration/app.test.ts` | Info, CORS, errors and static hosting            |
| `apps/server/test/shutdown.test.ts`        | Deadline/coalescing regressions                  |

## Measured scope

At **`0a8f04f`**, `git ls-tree -r --name-only HEAD apps/server` counts **149 `.ts` files in `apps/server/src/`** and **153 `*.test.ts` files in `apps/server/`**: **1.03 test files/source file**. Test inventory includes integration, GPU, live and repository-tooling tests; helpers/configs are excluded. CODEOWNERS and supplied default-branch history identify **1 unique human**, excluding bots, not an ownership guarantee. Source and targeted tests were inspected; no application tests or upstream calls were run.
