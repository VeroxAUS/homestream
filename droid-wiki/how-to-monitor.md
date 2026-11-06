# Monitoring

HomeStream exposes local logs, live events, session snapshots, and internal encoder/proxy statistics. It does not implement a metrics backend, alert rules, distributed tracing, or a finished monitoring dashboard. See [debugging](how-to-contribute/debugging.md).

## Logs and persisted events

`apps/server/src/logger.ts` creates an info-level Pino logger writing JSON lines to stdout and appending `server.log` under `DATA_DIR`. It applies field and full-line secret redaction. Logger level/stdout can be changed through constructor options, not a documented `LOG_LEVEL` environment variable. There is no log rotation in this module; file-write errors are swallowed.

Fastify automatic request logging is disabled in `apps/server/src/app.ts`. Do not expect a complete access log.

`apps/server/src/events/record.ts` records selected domain events in SQLite and emits them as `log`. It prunes every 200 writes, retaining at most 10,000 rows and removing entries older than 30 days. This is separate from the append-only Pino file. There is no public event-history query route.

## Live observations

- `GET /api/info` confirms the listener and reports name/version/addresses; it is not an upstream dependency health check.
- `GET /api/activity` lists session identity, device/client data, position, decision, state, errors, and encoder stats.
- `GET /api/sessions/:id` adds playback URLs, track lists, and selections.
- `GET /api/events` streams session lifecycle and domain log events.

SSE starts with a retry hint of 3000 ms and an immediate heartbeat, then sends a heartbeat every 15 seconds. Frames use named events and JSON data, not a durable journal. There are no IDs or replay; reconnecting observers should refetch activity. The bus reserves `health`, but current source has no health emitter. See [API](api/index.md).

## Interpreting performance

`packages/shared/src/playback.ts` defines encoder `fps`, `speed`, `bitrateKbps`, `outTimeSec`, and `headSegment`. `apps/server/src/playback/monitor.ts` publishes updates on the default two-second manager tick. Bitrate comes from up to ten completed segment sizes, not FFmpeg's often-unavailable HLS bitrate reading.

`apps/server/src/sourceproxy/proxy.ts` exposes an in-process `stats()` method: source count; requests/served bytes; memory-served bytes; upstream requests/bytes; link refreshes; cache bytes/blocks/evictions. `PlaybackManager.diskUsage()` reports encoded bytes and cap. Neither has a dedicated public metrics route.

Use these snapshots and logs to separate upstream throughput, encoding lead, cache pressure, and idle/disk cleanup. Do not infer GPU utilization, end-to-end latency percentiles, or automatic alert coverage from these counters.
