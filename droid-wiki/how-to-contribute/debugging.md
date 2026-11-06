# Debugging

Start with local readiness, then identify whether the failure belongs to configuration, discovery, playback or storage. Request IDs connect API responses to local logs; the maintained incident procedures are indexed in `docs/runbooks/README.md`.

## First minute

Against an already running local server:

```powershell
curl.exe http://localhost:8600/healthz
curl.exe http://localhost:8600/readyz
curl.exe http://localhost:8600/api/health
curl.exe "http://localhost:8600/api/logs?level=error&limit=50"
curl.exe http://localhost:8600/api/activity
```

Use `curl` on POSIX shells. `/healthz` only confirms the process serves requests. `/readyz` checks SQLite and data-directory writability, without upstream calls; it is limited to 300 requests per minute per caller address (`apps/server/src/routes/ops.ts`). A successful probe does not establish usable gateway credentials or NVENC.

`/api/health` returns the latest nine-check dashboard. `POST /api/health/run?fresh=1` requests fresh dependency checks, which can use network and a short NVENC encode, so do not loop it as a cheap probe (`apps/server/src/health/service.ts`, `apps/server/src/health/checks/ffmpeg.ts`).

## Correlate the evidence

`apps/server/src/http/observability.ts` returns `X-Request-ID`; search for it as `reqId` in the Pino JSON lines written to stdout and `server.log` inside `DATA_DIR` (`apps/server/src/logger.ts`). Caller IDs are accepted only when short and made of safe characters (`apps/server/src/requestContext.ts`).

`GET /api/logs` reads redacted persisted events, not the entire Pino log. It accepts `level`, `source`, and `limit`; SSE sends new events at `/api/events` (`apps/server/src/routes/health.ts`, `apps/server/src/routes/events.ts`). HLS, events and monitoring traffic is debug-level rather than an info line per scrape.

Enable startup timing details before starting the process:

```powershell
$env:LOG_LEVEL = 'debug'
pnpm --filter @homestream/server start
```

In POSIX shells use `LOG_LEVEL=debug pnpm --filter @homestream/server start`. Read [logging](../how-to-monitor/logging.md), [metrics](../how-to-monitor/metrics.md) and [tracing](../how-to-monitor/tracing.md) for the instrumentation boundaries.

## Match the symptom

| Symptom                                   | Check and next action                                                     | Maintained procedure                   |
| ----------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| Server will not start                     | Read visible terminal output; verify Node 24 and writable directories     | `docs/runbooks/README.md`              |
| Catalog works, streams do not             | Gateway health/logs; distinguish missing manifest, timeout and rate limit | `docs/runbooks/gateway-down.md`        |
| Start returns 202, no playback session    | Inspect `/api/downloads`, its failure reason and TorBox health            | `docs/runbooks/torbox-expired.md`      |
| `encoder_failed` / `encoder_memory_limit` | FFmpeg/ffprobe, NVENC support, driver, GPU load and RSS cap               | `docs/runbooks/encoder-failing.md`     |
| Segments stall / disk warnings            | Free space, `TRANSCODE_MAX_GB`, encoder parking and disposable cache      | `docs/runbooks/disk-full-transcode.md` |
| FFmpeg survives shutdown                  | Recorded PID ownership and command-line match; never kill by name         | `docs/runbooks/ffmpeg-orphans.md`      |
| Regression after update                   | Separate worktree or history-preserving revert                            | `docs/runbooks/rollback.md`            |
| Passes on retry                           | Shared state, real timers, unawaited work, worker pressure                | `docs/runbooks/flaky-tests.md`         |
| Error alert                               | Match release/request ID; privacy leakage takes priority                  | `docs/runbooks/sentry-triage.md`       |

Missing required upstream settings warn rather than prevent startup (`apps/server/src/index.ts`). Configuration precedence is explicit file override, repository `.env`, then app-data fallback; nonblank process settings override chosen file values (`apps/server/src/config.ts`). Restart after edits. On Linux, replace Windows default storage paths; do not interpret them as valid deployment defaults.

A Vite page loading on 8601 proves only that the development client is served. Its API/HLS proxy still targets 8600 even if the server port changed (`apps/web/vite.config.ts`). Use the browser Network panel to inspect the API error envelope and response request ID. `apiFetch` and `apiGet` in `apps/web/src/api/client.ts` attach IDs and expose `ApiError`; `apps/web/src/logger.ts` provides scrubbed client breadcrumbs. Do not paste raw request bodies or URLs with user text into an issue.

Home, search, details and Settings are real screens; a Play link reaching the placeholder player is not an encoder failure. Dashboard tabs also remain placeholders (`apps/web/src/pages/PlayerPage.tsx`, `apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`). See [screens](../apps/web/screens.md) and [data and startup](../apps/web/data-and-startup.md).

For telemetry that does not appear, distinguish a no-key build from runtime opt-out. Web keys are baked in by `apps/web/vite.config.ts`; changing server environment after the build cannot add them. SDK loading waits for Home content and idle time. Reproduce with the isolated telemetry browser project rather than deliberately sending production reports ([telemetry](../systems/telemetry.md), [testing](testing.md)).

## Playback-specific checks

Compare `/api/sessions/:id` with `/api/activity`: capability/output decision, selected tracks, startup attempts, encoder speed and error. Start returns 201 only after a first segment exists; 202 is a download, and 502 `all_streams_failed` can include per-source attempts (`apps/server/src/playback/manager.ts`).

Audio/subtitle PATCH may restart encoding; player progress is a separate POST. Far-segment HLS requests can trigger seek restarts. Duration-derived manifests can list files not encoded yet, and text subtitle extraction is progressive. Use returned playlist/track URLs instead of reconstructing paths. See [API](../api/index.md), [lifecycle](../systems/playback/lifecycle.md), [subtitles](../systems/playback/subtitles.md), [source proxy](../systems/source-proxy.md), and [network controls](../systems/network.md).

## Measure rather than guess

`pnpm profile:server` uses `scripts/profile-server.mjs` to start a throwaway profiled server, default port 8602, with telemetry/NVENC health testing off, and writes CPU profiles into `reports/profiles`. It exercises light traffic, not real playback. Follow `docs/runbooks/profiling.md` for a real workload and compare identical title/client/settings before and after a hot-path change.

The profiler inherits the process environment and does not install the browser suite's outbound-fetch restriction; its request loop is local-only, but it is not an isolated upstream stub harness. Do not overlap it with Playwright, which also uses 8602. `pnpm --filter @homestream/web analyze` writes `apps/web/reports/bundle.html`; follow `docs/runbooks/web-bundle-budget.md` before changing a bundle ceiling. Turbo cache/environment surprises are covered in [tooling](tooling.md).

Profiles and local logs may contain machine paths or viewing details. Share reviewed redacted excerpts and a reproducer, never `.env`, raw upstream payloads or a database. [Testing](testing.md) describes stub-first reproduction and [security](../security.md) describes private reporting.

## Key source files

| File                                        | Purpose                                           |
| ------------------------------------------- | ------------------------------------------------- |
| `apps/server/src/index.ts`                  | Startup warnings, listeners, workers and shutdown |
| `apps/server/src/config.ts`                 | File selection and setting defaults               |
| `apps/server/src/routes/ops.ts`             | Local liveness/readiness                          |
| `apps/server/src/logger.ts`                 | Structured console/file log                       |
| `apps/server/src/playback/startTimeline.ts` | Startup-stage timing                              |
| `scripts/profile-server.mjs`                | Bounded profiling workload                        |
| `docs/runbooks/README.md`                   | Operational procedure index                       |
