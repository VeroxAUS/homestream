# Server

Active contributors: VeroxAUS

## Purpose

`@homestream/server` is the LAN runtime. It serves HTTP, SSE, HLS and optional web assets while owning SQLite, upstream clients, playback encoders and background work (`apps/server/src/app.ts`).

## Composition and layout

`buildApp` in `apps/server/src/app.ts` constructs one dependency graph and exposes it as the typed `AppContext` in `apps/server/src/context.ts`:

- Configuration, logger, SQLite, event bus, telemetry and metrics are shared infrastructure.
- TMDB and the gateway feed streams, catalog/home and continue watching.
- The source proxy is shared by playback and prefetch.
- Download tracking uses the same gateway/stream services as playback.
- Health reads the composed services rather than creating a second playback pipeline.

Domain logic lives under `apps/server/src/tmdb/`, `apps/server/src/streams/`, `apps/server/src/playback/`, `apps/server/src/sourceproxy/`, `apps/server/src/downloads/`, `apps/server/src/progress/` and neighboring service directories. HTTP adapters live under `apps/server/src/routes/`.

## Startup and resource ownership

`apps/server/src/index.ts` loads configuration, creates the data directory/logger, and records warnings without aborting solely because upstream keys are absent. It then builds the app, recovers orphaned encoders, starts the loopback source proxy, and starts the public listener. Health scheduling and download polling start after listening; startup telemetry and mDNS advertisement follow.

`buildApp` alone does not start those periodic workers. Its injection seams replace the database, bus, TMDB/gateway clients, telemetry, probe, URL resolver, encoder factory, network checks, clocks and selected limits for tests (`apps/server/src/app.ts`).

On close, the app stops health/download scheduling, awaits playback and proxy cleanup, then closes telemetry, gateway, database and logger only where it owns them. Injected database, gateway, telemetry and logger lifetimes remain the caller's responsibility. Prefetch exposes `idle()`, but the app close hook does not explicitly await it (`apps/server/src/prefetch/service.ts`).

SIGINT, SIGTERM, SIGBREAK, shutdown IPC and `shutdown` on stdin converge on one bounded shutdown helper. The process stops mDNS, closes the app, then closes its externally supplied logger (`apps/server/src/index.ts`, `apps/server/src/shutdown.ts`).

## HTTP integration

The composition root registers info/devices, catalog/streams, sessions/HLS, downloads, progress/continue-watching, history/stats, prefetch, health/operations and events. Shared schemas validate route inputs. Expected `AppError`s retain their status and redacted error envelope; unexpected server failures become generic 500s and are reported to logging/optional telemetry (`apps/server/src/app.ts`, `apps/server/src/errors.ts`).

CORS allows any origin; it is not access control. Built assets get a selective SPA fallback, while API and media misses remain errors (`apps/server/src/app.ts`, `apps/server/src/routes/static.ts`). Request observability sanitizes request IDs and supplies `X-Request-ID` (`apps/server/src/http/observability.ts`).

For implementation details, follow [API](../api/index.md), [playback](../systems/playback/index.md), [gateway](../systems/gateway.md), [health](../systems/health.md), [telemetry](../systems/telemetry.md) and [monitoring](../how-to-monitor/index.md).

## Modification entry points

Add service dependencies at `apps/server/src/app.ts` and `apps/server/src/context.ts`; keep handlers thin and rules in domain modules. Change process-level startup in `apps/server/src/index.ts`, not in route registration. `apps/server/package.json` builds shared contracts before compiling the server and separates offline unit/integration suites from GPU/live tiers.

## Key source files

| File                                       | Purpose                                                          |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `apps/server/src/index.ts`                 | Process entry, worker startup, discovery and shutdown            |
| `apps/server/src/app.ts`                   | Construction, injection seams, routes and owned-resource cleanup |
| `apps/server/src/context.ts`               | Typed dependency graph                                           |
| `apps/server/src/config.ts`                | Configuration and secret registration                            |
| `apps/server/src/db/index.ts`              | SQLite connection and migrations                                 |
| `apps/server/src/shutdown.ts`              | Bounded shared shutdown operation                                |
| `apps/server/src/routes/static.ts`         | Web assets and SPA fallback policy                               |
| `apps/server/package.json`                 | Runtime dependencies and commands                                |
| `apps/server/test/integration/app.test.ts` | App composition/HTTP tests                                       |

## Measured scope

Tracked `apps/server/src/**/*.ts`: **130 source files**. Tracked `apps/server/**/*.test.ts`: **109 test files**, including script, GPU and live tests; **0.84 test-to-code file ratio**. Fixtures/helpers, configs and outputs are excluded. Default-branch source ownership/history has **1 unique human author**, VeroxAUS, excluding bots. These counts do not imply that every test is offline or was executed for this documentation.
