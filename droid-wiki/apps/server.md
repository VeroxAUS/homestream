# Server
Active contributors: VeroxAUS

`@homestream/server` is the implemented LAN runtime: Fastify serves the API, events, HLS and optional built web assets, while server-side services discover sources and manage playback.

## Key abstractions

| Abstraction | Source | Responsibility |
| --- | --- | --- |
| Process lifecycle | `apps/server/src/index.ts` | Configuration, logging, orphan recovery, listeners, mDNS and shutdown |
| Composition root | `apps/server/src/app.ts` | Constructs services, registers routes and close hooks |
| AppContext | `apps/server/src/context.ts` | Typed dependency graph attached as `app.ctx` |
| Configuration | `apps/server/src/config.ts` | Runtime settings and secret registration |
| Persistence | `apps/server/src/db/index.ts` | SQLite ownership and migrations |
| Discovery | `apps/server/src/discovery.ts` | LAN mDNS advertisement |
| Error/log boundary | `apps/server/src/errors.ts`, `apps/server/src/logger.ts`, `apps/server/src/redact.ts` | Error envelopes and redaction |

## Startup and shutdown

1. Find the repository unless packaged mode is enabled; load configuration and locate `apps/web/dist`.
2. Create the data directory and logger; warn about missing configuration.
3. Build the app, recover orphan encoders, start the loopback source proxy, then start the public listener.
4. Advertise the public port with mDNS.
5. On SIGINT/SIGTERM/SIGBREAK, shutdown IPC, or `shutdown` on stdin, stop discovery, close the app and logger, then exit.

`buildApp` composes SQLite, event bus, TMDB, gateway, streams, source proxy, playback and prefetch. Its close hook closes playback and proxy, then closes gateway/database only if it created them. An internally created logger is also closed. `BuildAppOptions` allows injected database, bus, metadata/gateway services, probe, resolver and selected timing/capacity settings for tests.

## HTTP integration

`apps/server/src/app.ts` registers info, device, catalog, stream, session, prefetch and event routes. CORS permits any origin and the configured HTTP methods; it is not authentication. Optional static assets get a selective SPA fallback. Expected `AppError`s retain their status and envelope; unexpected server failures become a generic 500 response and are logged.

See [API](../api/index.md), [gateway](../systems/gateway.md), [playback](../systems/playback/index.md), [source proxy](../systems/source-proxy.md), and [prefetch](../features/prefetch.md) rather than treating these as browser-side services.

## Modification and measurement

Start new integrations at `apps/server/src/app.ts` and `apps/server/src/context.ts`; keep request parsing in `apps/server/src/routes/` and domain behavior in its service directory. `apps/server/package.json` provides `dev`, `build`, `start`, `typecheck`, `lint` and `test`; the build compiles shared contracts first.

Measured `apps/server` scope: **62 production source files**, **37 test files**, **1 unique committer**. Source means tracked `.ts` files under `apps/server/src/`; tests mean tracked `*.test.ts` under `apps/server/test/`, including encode and opt-in live suites, excluding fixtures/helpers. Committers are distinct `%cn <%ce>` identities from Git history scoped to `apps/server`. These are file counts, not coverage or passing-test claims.
