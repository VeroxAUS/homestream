# Logging

Process logs, selected durable events and SSE are distinct channels in `apps/server/src/logger.ts`, `apps/server/src/events/record.ts` and `apps/server/src/routes/events.ts`. Use the request ID for HTTP context, event queries for domain history and SSE for live change notifications. See [monitoring](index.md).

## Server process log

`createLogger` in `apps/server/src/logger.ts` emits Pino JSON lines to stdout and appends **`DATA_DIR/server.log`**. Runtime `LOG_LEVEL` defaults to info and supports debug/info/warn/error (`apps/server/src/config.ts`, `apps/server/src/index.ts`). Direct app construction can use an injected logger.

The logger does not implement file rotation or size retention. Stream errors are swallowed, so process liveness alone does not establish that the file is writable. Writes use streams, but serialization/redaction still run at the logging call: avoid oversized payloads and segment-level chatter.

`registerRequestObservability` in `apps/server/src/http/observability.ts` replaces automatic access logging. Completion fields are `reqId`, method, route template (or `unmatched`), status code and response time rounded to one decimal; it does not log raw queries.

**HLS, `/metrics`, `/healthz`, `/readyz` and `/api/events`** are excluded from HTTP request metrics and use debug-level completion logging. Turning on debug increases high-volume media noise; keep it bounded.

## Request correlation

`resolveRequestId` in `apps/server/src/requestContext.ts` accepts 1–64 letters/digits/dots/underscores/hyphens, otherwise generates a UUID. Responses echo `X-Request-ID`; AsyncLocalStorage carries it into service calls, and the logger mixin adds `reqId` unless already bound.

Search the exact ID in the local file, for example:

```powershell
Select-String -Path "$env:DATA_DIR\server.log" -SimpleMatch 'client.req_42-A'
```

Substitute the actual configured data directory if configuration came from a file rather than shell environment. Optional unexpected-error reports use `request_id`. Background work need not retain request scope; IDs are neither credentials nor a guaranteed upstream trace. See [tracing](tracing.md).

## Durable event history

`logEvent` in `apps/server/src/events/record.ts` redacts a message/details, inserts an SQLite `events` row, then emits a `log` bus event. Rows contain ID, epoch timestamp, level, source, message, nullable details and nullable session ID.

Levels are info/warn/error. Sources include gateway, TMDB, TorBox, FFmpeg, session, health, server, prefetch and downloads. Domain events are deliberately selected lifecycle/status information, not copies of every Pino line.

Every **200 writes**, pruning removes events older than **30 days** and rows beyond the newest **10,000**. These are periodic write-triggered retention rules, not exact per-insert bounds or a background expiry timer.

`queryEvents` in `apps/server/src/events/query.ts` reads/filter/redacts stored rows. GET `/api/logs` supports level/source/limit (default 100, maximum 1000) through `apps/server/src/routes/health.ts`. REST omits absent optional fields, while direct SSE rows can retain nulls. There is no HTTP route for downloading the raw process file.

## Live SSE

`registerEventRoutes` in `apps/server/src/routes/events.ts` begins with `retry: 3000` and a heartbeat, then repeats heartbeat every **15 seconds**. Application frames contain event name and JSON `event.data`, not the internal bus envelope:

```text
event: heartbeat
data: {"ts":1700000000000}

```

The timestamp is illustrative. Application payloads use their shared schemas.

Session start/update/end, health, log and download events share the stream. It has no event-ID cursor/Last-Event-ID replay. Opening does not send a health baseline; reconnect consumers need REST reconciliation. Browser health reads are routed through the query cache with cancellation of older answers (`apps/web/src/events/serverEvents.ts`). Unnotified completed downloads have a special persisted replay path, not a general event backlog.

Connections unsubscribe/clear timers on close/error; server pre-close ends open streams so shutdown is not blocked waiting on them. See [API event protocol](../api/index.md).

## Browser and desktop

`apps/web/src/logger.ts` provides development-console logging and buffers up to **50 non-debug entries** until an optional telemetry sink attaches. The logger does not scrub that console/buffer itself; outbound breadcrumbs pass through the Sentry sanitizer in `apps/web/src/telemetry/sentry.ts`. This is not a browser log-file service, and secrets/user text must never enter the call sites.

Desktop `startTelemetry` in `apps/desktop/src/shell/telemetry.ts` wires `apps/desktop/src/logger.ts` to **`DATA_DIR/desktop.log`**, sharing the main scrubber and optional Sentry breadcrumb sink. At startup, an existing log larger than **2 MiB** is renamed to `desktop.log.1`; it is not continuously size-rotated while the process runs. Sink/open failures degrade without taking down the shell.

Main initialization, restart/supervisor events and graceful quit are implemented; desktop logging is no longer an unwired helper. See [desktop](../apps/desktop/index.md).

## Safe changes

Pino censors structured token/auth/cookie/URL/query fields and redacts the full serialized line again (`apps/server/src/logger.ts`, `apps/server/src/redact.ts`). Events scrub before storage, on bus emission and on reads. These layers do not permit raw source URLs, keys, request bodies or user text in logs.

Local logs can still contain operational paths and session/device details. Desktop structured-field scrubbing handles top-level strings and Error messages, not arbitrary nested objects (`apps/desktop/src/logger.ts`); do not pass unreviewed nested payloads. Treat storage/backups as private and review output before sharing. Use fixed messages and small structured fields; persist only events worth keeping/displaying. See [security](../security.md), [configuration](../reference/configuration.md) and [data models](../reference/data-models.md).

The behavior above was checked against source at **`0a8f04f` on 2026-11-08**. No running log sink or retention job was exercised.

## Key source files

| File                                                 | Purpose                                        |
| ---------------------------------------------------- | ---------------------------------------------- |
| `apps/server/src/logger.ts`                          | Pino destinations, redaction and request mixin |
| `apps/server/src/http/observability.ts`              | Completion fields/exclusions                   |
| `apps/server/src/requestContext.ts`                  | ID validation and async scope                  |
| `apps/server/src/events/record.ts`                   | Durable writes and pruning                     |
| `apps/server/src/events/query.ts`                    | Filtering/read-time redaction                  |
| `apps/server/src/routes/events.ts`                   | SSE framing and lifetime                       |
| `apps/desktop/src/shell/telemetry.ts`                | Main log sink and startup rollover             |
| `apps/server/test/integration/observability.test.ts` | Request/log/probe integration                  |
| `apps/server/test/integration/health-routes.test.ts` | Event queries and SSE                          |
