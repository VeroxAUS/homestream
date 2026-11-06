# Logging

Process logs, domain events and SSE are separate channels. Use process logs for request/error context, `/api/logs` for selected durable events, and SSE for live updates (`apps/server/src/logger.ts`, `apps/server/src/events/record.ts`, `apps/server/src/routes/events.ts`).

## Process logs

`createLogger` in `apps/server/src/logger.ts` writes one Pino JSON object per line to stdout and appends to the process log in `DATA_DIR`. Normal startup passes `LOG_LEVEL` from configuration; supported values are `debug`, `info`, `warn`, `error`, default **info** (`apps/server/src/index.ts`, `apps/server/src/config.ts`). Direct `buildApp` construction without an injected logger uses `createLogger`'s own info default (`apps/server/src/app.ts`).

There is no rotation/size retention in the logger module. File-stream errors are swallowed; a running process is not proof that the file is writable. Log writes are stream-based, but serialization/redaction happen at the call site. Avoid per-segment chatter or large objects on playback paths.

Fastify's automatic access logging is disabled and replaced by `registerRequestObservability` in `apps/server/src/http/observability.ts`. Completed instrumented requests log:

- `reqId`, `method`, route template (or `unmatched`), `statusCode`.
- `responseTimeMs`, rounded to one decimal.

The line never uses the raw query/URL. `/hls/*`, `/metrics`, `/healthz`, `/readyz` and `/api/events` use debug-level completion logging and are excluded from HTTP metrics. Selecting debug therefore increases high-volume traffic logging; keep production debugging bounded.

## Request correlation

`apps/server/src/requestContext.ts` accepts a client `X-Request-ID` only if it is at most **64 characters** of letters, digits, `.`, `_`, `-`; otherwise it creates a UUID. The response echoes the resolved ID, including errors. AsyncLocalStorage carries it into service calls; the base logger mixin adds `reqId` unless a child logger already binds it.

Find that exact ID in the local process log. For example, in PowerShell, with `DATA_DIR` set to the actual configured directory:

```powershell
Select-String -Path "$env:DATA_DIR\server.log" -SimpleMatch 'client.req_42-A'
```

File-loaded settings do not automatically populate the shell environment, so substitute the configured path when needed. Unexpected HTTP errors also carry `request_id` in optional Sentry reports. A request ID is not an authorization token or an automatically propagated upstream trace; see [tracing](tracing.md).

## Domain event log

`logEvent` in `apps/server/src/events/record.ts` synchronously inserts a redacted SQLite row, then emits a `log` bus event. Levels are `info`, `warn`, `error`; sources are `gateway`, `tmdb`, `torbox`, `ffmpeg`, `session`, `health`, `server`, `prefetch`, `downloads` (`packages/shared/src/schemas.ts`).

`GET /api/logs` returns newest IDs first. Optional `level` and `source` filters are exact enum values; `limit` defaults to **100**, accepts integers **1–1000**, and rejects out-of-range/invalid values rather than clamping (`apps/server/src/routes/health.ts`, `packages/shared/src/health.ts`). Rows are redacted again when queried (`apps/server/src/events/query.ts`).

Pruning runs every **200 writes**, removing rows older than **30 days** and retaining the newest **10,000**. These are periodic bounds, not a deletion deadline at exactly 30 days or a hard instantaneous row ceiling. This retention does not rotate the process log or erase watch history.

## SSE

`apps/server/src/routes/events.ts` sends `retry: 3000`, an immediate heartbeat and another every **15 seconds**. Named events include `health`, `session.start/update/end`, `log` and download lifecycle events (`apps/server/src/events/bus.ts`). Subscriber failures are isolated and payload strings pass through local redaction.

There are no SSE IDs or generic `Last-Event-ID` replay. Reconnect and refetch health/activity/log snapshots. Downloads separately replay unnotified ready items; that is a domain notification mechanism, not event-stream history. The server ends open SSE responses in `preClose` so shutdown can proceed.

## Adding logs safely

Use structured fixed fields and stable messages. Pino censors token/auth/cookie/url/query paths, and the entire serialized line passes through `redact()` again (`apps/server/src/logger.ts`, `apps/server/src/redact.ts`). The local scrubber knows registered credentials, gateway components and CDN patterns; it does not anonymize every IP, device name or filesystem path. Review output before sharing, and never log request bodies or source URLs.

Use a domain event only for something worth persisting/displaying, not every request or segment. See [data models](../reference/data-models.md), [health](../systems/health.md) and the maintained `docs/observability.md`.

## Key source files

| File                                                 | Purpose                                                   |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `apps/server/src/logger.ts`                          | Pino destinations, structured redaction and request mixin |
| `apps/server/src/http/observability.ts`              | Completion lines and excluded paths                       |
| `apps/server/src/requestContext.ts`                  | Request ID validation and async scope                     |
| `apps/server/src/events/record.ts`                   | Durable event insertion and pruning                       |
| `apps/server/src/events/query.ts`                    | Filtered query and read-time redaction                    |
| `apps/server/src/routes/events.ts`                   | SSE frames, heartbeat and cleanup                         |
| `apps/server/test/integration/observability.test.ts` | Log fields, request IDs and probe behavior                |
| `apps/server/test/integration/health-routes.test.ts` | Event query and SSE behavior                              |
