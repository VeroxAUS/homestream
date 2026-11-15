# Logging

Process logs, selected durable events and SSE are distinct channels in `apps/server/src/logger.ts`, `apps/server/src/events/record.ts` and `apps/server/src/routes/events.ts`. Use the request ID for HTTP context, event queries for domain history and SSE for live change notifications. See [monitoring](index.md).

## Server process log

`createLogger` in `apps/server/src/logger.ts` emits Pino JSON lines to stdout and appends **`DATA_DIR/server.log`**. Runtime `LOG_LEVEL` defaults to info and supports debug/info/warn/error (`apps/server/src/config.ts`, `apps/server/src/index.ts`). Direct app construction can use an injected logger.

The logger does not implement file rotation or size retention. Stream errors are swallowed, so process liveness alone does not establish that the file is writable. Writes use streams, but serialization/redaction still run at the logging call: avoid oversized payloads and segment-level chatter.

`registerRequestObservability` in `apps/server/src/http/observability.ts` replaces automatic access logging. Completion fields are `reqId`, method, route template (or `unmatched`), status code and response time rounded to one decimal; it does not log raw queries.

**HLS, `/metrics`, `/healthz`, `/readyz` and `/api/events`** are excluded from HTTP request metrics. HLS and probes use debug-level completion logging. The hijacked SSE reply bypasses `onResponse`: `apps/server/src/routes/events.ts` instead writes one info-level **`event stream opened`** line when each subscription starts, with `reqId`, `method`, route template and `statusCode: 200`. There is no completion duration, heartbeat log or per-event access log. Turning on debug increases high-volume media noise; keep it bounded.

## Request correlation

`resolveRequestId` in `apps/server/src/requestContext.ts` accepts 1–64 letters/digits/dots/underscores/hyphens, otherwise generates a UUID. Responses echo `X-Request-ID`; AsyncLocalStorage carries it into service calls, and the logger mixin adds `reqId` unless already bound.

Search the exact ID in the local file, for example:

```powershell
Select-String -Path "$env:DATA_DIR\server.log" -SimpleMatch 'client.req_42-A'
```

Substitute the actual configured data directory if configuration came from a file rather than shell environment. Optional unexpected-error reports use `request_id`. Background work need not retain request scope; IDs are neither credentials nor a guaranteed upstream trace. See [tracing](tracing.md).

## Read-ahead transitions

`createReadAheadNotes` in `apps/server/src/sourceproxy/readAheadNotes.ts` writes info-level **`Read-ahead window closed`** and **`Read-ahead window reopened`** lines. `ReaderHolds` in `apps/server/src/sourceproxy/readerHolds.ts` reports changes between `waiting` and `filling`, not every progress update. Resetting a waiting window on start, seek or restart also reports reopening with zero lead.

| Field                          | Meaning                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `sessionId`, `state`           | Owner whose window changed, and its new `waiting` or `filling` state                                  |
| `leadSec`                      | Actual encoded lead rounded to one decimal, not the anticipated closing lead                          |
| `rssMb`, `heapUsedMb`          | Server process resident memory and used JavaScript heap                                               |
| `externalMb`, `arrayBuffersMb` | Node external allocations and ArrayBuffer/Buffer memory; these overlap and must not be added together |
| `cacheMb`, `cacheBlocks`       | Rolling block-cache bytes and block count across the proxy, not only this session                     |

Despite the `Mb` suffix, memory fields are rounded **MiB** (bytes divided by 1,048,576), not decimal MB or megabits. Process figures come from `process.memoryUsage()` in `apps/server/src/sourceproxy/readAheadNotes.ts`; they do not measure FFmpeg child-process RSS. Cache figures come from `BlockCache.stats` in `apps/server/src/sourceproxy/blockCache.ts`, not all buffers or pinned head/tail data.

`SourceProxy` in `apps/server/src/sourceproxy/proxy.ts` creates one logger callback shared across its sources and sessions. It suppresses transitions less than **one second** after the last emitted line and samples memory only when emitting. Suppressed transitions are dropped, not queued, so these lines are diagnostic snapshots rather than a complete state history. They are process-log entries, not durable database events or new analytics events.

Compare close/reopen snapshots when investigating memory growth or a download rate that stays low after resuming. A close can occur below the nominal measured lead because pacing anticipates progress latency and in-flight bytes; see [network controls](../systems/network.md#read-ahead-and-feedback). The smaller [extractor byte-gap bound](../systems/source-proxy.md#three-independent-reader-controls) reduces how much cached subtitle-reader data the encoder consumes before downloading again.

`apps/server/test/sourceproxy/readAheadNotes.test.ts` covers transition/reset notifications, MiB formatting, throttling and proxy wiring. These tests were inspected for this documentation refresh; no live memory or download measurement was run.

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

Desktop `startTelemetry` in `apps/desktop/src/shell/telemetry.ts` wires `apps/desktop/src/logger.ts` to **`DATA_DIR/desktop.log`**, sharing the main scrubber and optional Sentry breadcrumb sink. Main-process entries at info and above become Sentry breadcrumbs in category **`main`**, distinct from renderer category `log` (`apps/desktop/src/telemetry/sentry.ts`, `docs/observability.md`). At startup, an existing log larger than **2 MiB** is renamed to `desktop.log.1`; it is not continuously size-rotated while the process runs. Sink/open failures degrade without taking down the shell.

Main initialization, restart/supervisor events and graceful quit are implemented; desktop logging is no longer an unwired helper. See [desktop](../apps/desktop/index.md).

## Safe changes

Pino censors structured token/auth/cookie/URL/query fields and redacts the full serialized line again (`apps/server/src/logger.ts`, `apps/server/src/redact.ts`). Events scrub before storage, on bus emission and on reads. These layers do not permit raw source URLs, keys, request bodies or user text in logs.

Local logs can still contain operational paths and session/device details. Desktop structured-field scrubbing handles top-level strings and Error messages, not arbitrary nested objects (`apps/desktop/src/logger.ts`); do not pass unreviewed nested payloads. Treat storage/backups as private and review output before sharing. Use fixed messages and small structured fields; persist only events worth keeping/displaying. See [security](../security.md), [configuration](../reference/configuration.md) and [data models](../reference/data-models.md).

SSE opening logs and desktop breadcrumb wiring were refreshed against **`663492c` on 2026-11-10**; unaffected retention details retain their earlier source inspection. No running log sink or retention job was exercised. `apps/server/test/integration/events.test.ts` checks that the opening line exists while the stream remains connected and that heartbeats/events add no duplicate request lines.

## Key source files

| File                                                  | Purpose                                           |
| ----------------------------------------------------- | ------------------------------------------------- |
| `apps/server/src/logger.ts`                           | Pino destinations, redaction and request mixin    |
| `apps/server/src/http/observability.ts`               | Completion fields/exclusions                      |
| `apps/server/src/requestContext.ts`                   | ID validation and async scope                     |
| `apps/server/src/sourceproxy/readAheadNotes.ts`       | Throttled read-ahead transition memory snapshots  |
| `apps/server/src/sourceproxy/readerHolds.ts`          | Window state-change and reset notifications       |
| `apps/server/test/sourceproxy/readAheadNotes.test.ts` | Transition, formatting, throttle and wiring tests |
| `apps/server/src/events/record.ts`                    | Durable writes and pruning                        |
| `apps/server/src/events/query.ts`                     | Filtering/read-time redaction                     |
| `apps/server/src/routes/events.ts`                    | SSE framing and lifetime                          |
| `apps/desktop/src/shell/telemetry.ts`                 | Main log sink and startup rollover                |
| `apps/server/test/integration/observability.test.ts`  | Request/log/probe integration                     |
| `apps/server/test/integration/events.test.ts`         | One correlated opening line per live subscription |
| `apps/server/test/integration/health-routes.test.ts`  | Event queries and SSE                             |
