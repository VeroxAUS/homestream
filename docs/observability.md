# Observability

How to see what the HomeStream server is doing: request ids, structured logs, Prometheus metrics, health probes, Sentry error reports, PostHog product events and feature flags. What leaves the machine is listed in [PRIVACY.md](PRIVACY.md); alert rules are in [alerting.md](alerting.md).

Everything here is asynchronous and cheap by design. Telemetry never blocks a request, and `/hls/*`, `/metrics`, `/healthz`, `/readyz` and `/api/events` are not instrumented per request.

## Request ids

- Every response has an `X-Request-ID` header. A request that sends one keeps it when it is at most 64 characters of `A-Z a-z 0-9 . _ -`; anything else (too long, other characters) is replaced by a fresh UUID.
- The id is the `reqId` field of every `server.log` line written while the request runs, so one grep finds the whole story: `Select-String -Path "$env:DATA_DIR\server.log" -SimpleMatch '<the id>'`.
- Browsers can read the header (`Access-Control-Expose-Headers`), and `X-Request-ID`, `sentry-trace` and `baggage` are accepted as request headers by CORS.
- Server errors reported to Sentry carry the id as the tag `request_id`.
- Error bodies keep their shape: `{"error":{"code","message","hint?"}}`.

## Logs

`server.log` in `DATA_DIR` is one JSON object per line (pino). Each finished request logs one line at `info` with `reqId`, `method`, `route` (the route template, for example `/api/movie/:tmdbId`, never the raw URL), `statusCode` and `responseTimeMs`. Requests to the paths listed above log at `debug` only, so a Prometheus scrape does not fill the log. Every line passes through `redact()`, and pino additionally redacts authorization, cookie and token fields.

## Metrics (`GET /metrics`)

Prometheus text format. Process metrics come from prom-client's defaults (`process_*`, `nodejs_*`). HomeStream adds:

| Metric                                                                                           | Type      | Labels                      | Meaning                                                      |
| ------------------------------------------------------------------------------------------------ | --------- | --------------------------- | ------------------------------------------------------------ |
| `homestream_http_requests_total`                                                                 | counter   | `method`, `route`, `status` | Requests handled, by route template                          |
| `homestream_http_request_duration_seconds`                                                       | histogram | `method`, `route`, `status` | Request duration                                             |
| `homestream_sessions_active`                                                                     | gauge     |                             | Live playback sessions                                       |
| `homestream_sessions_started_total`                                                              | counter   |                             | Sessions that produced a first segment                       |
| `homestream_sessions_failed_total`                                                               | counter   | `stage`, `code`             | Sessions that failed to start or failed while playing        |
| `homestream_encoder_speed_avg`, `homestream_encoder_speed_min`                                   | gauge     |                             | Encoder speed of live sessions (1 is real time), 0 when idle |
| `homestream_encoder_restarts_total`                                                              | counter   | `reason`                    | Encoder restarts: `retry`, `seek`, `tracks`, `resume`        |
| `homestream_gateway_requests_total`, `_errors_total`, `_cache_hits_total`, `_cache_misses_total` | counter   |                             | Gateway lookups                                              |
| `homestream_tmdb_requests_total`, `_errors_total`, `_cache_hits_total`, `_cache_misses_total`    | counter   |                             | TMDB requests                                                |
| `homestream_sourceproxy_cache_hits_total`, `homestream_sourceproxy_cache_misses_total`           | counter   |                             | Source proxy block cache                                     |
| `homestream_sourceproxy_cache_bytes`                                                             | gauge     |                             | Bytes in the source proxy block cache                        |

Label values are route templates, status codes and short fixed codes. They never contain ids, URLs, hosts or secrets. The service counters are read when Prometheus scrapes, so the playback path only bumps plain integers.

The server listens on the local network only, and `/metrics` is open to it like the rest of the API. Do not forward the port to the internet. A minimal scrape setup is in `monitoring/prometheus/prometheus.yml`.

## Health probes

| Endpoint       | Answers                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz` | `200 {"status":"ok"}` while the process runs. Nothing else is checked.                                                                                         |
| `GET /readyz`  | `200 {"status":"ready"}` when the database answers and a file can be written in the data directory; otherwise `503` with `{"error":{"code":"not_ready",...}}`. |

Neither calls TMDB, the gateway, TorBox or ffmpeg. For the full picture (gateway, GPU, disk) use `GET /api/health`. Its `disk` check warns when the fuller of the `TRANSCODE_DIR` and `DATA_DIR` drives has less than `DISK_WARN_FREE_GB` free (default 20 GB) and is an error under 5 GB; see the [disk-full runbook](runbooks/disk-full-transcode.md).

## Telemetry

Telemetry code lives in `apps/server/src/telemetry`. It is off unless a key is set, and `HOMESTREAM_TELEMETRY=off` turns everything off:

| Key                  | Enables                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `SENTRY_DSN_SERVER`  | Error reports to the Sentry project `homestream-server`              |
| `SENTRY_ENVIRONMENT` | Environment name (default `development`, `production` when packaged) |
| `POSTHOG_API_KEY`    | Product events and feature flags                                     |
| `POSTHOG_HOST`       | PostHog ingestion host (default `https://us.i.posthog.com`)          |

- **Sentry** (`@sentry/node`): release `homestream@<version>`, the environment, the tags `device.kind`, `media.type` and `request_id`, 5 % performance sampling, no HTTP, console or session auto-instrumentation. `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb` run every payload through the shared sanitizer in `packages/shared/src/sanitize.ts`: registered secrets, authorization fields, gateway and CDN URLs, query strings, private network addresses and Windows user folders are removed, and no user data, `ip_address`, `server_name` or request is ever set (the only `user` content is an empty `geo`, see below).
- **PostHog** (`posthog-node`): events come from the typed catalog in `packages/shared/src/analytics.ts` (listed in [PRIVACY.md](PRIVACY.md)), only allowlisted properties are kept, and the queue is flushed on shutdown. The identity is a random install id stored in the `settings` table.
- **Feature flags**: [experimentation.md](experimentation.md).

### Web UI and desktop shell

Code: `apps/web/src/telemetry` (renderer) and `apps/desktop/src/telemetry` (main process). Both report to the Sentry project `homestream-web` (`SENTRY_DSN_WEB`) and the PostHog project of the server (`POSTHOG_API_KEY`); events are told apart by the tags `app` (`web` / `desktop`) and `process` (`renderer` / `main`).

- The web UI reads its keys when it is built and bakes them into the bundle. Without `SENTRY_DSN_WEB` and `POSTHOG_API_KEY` (or with `HOMESTREAM_TELEMETRY=off` at build time) no telemetry code is requested and nothing is sent. The telemetry chunk is loaded after Home is shown and the browser is idle, so it never delays Home.
- The renderer uses `@sentry/react` for errors only (release `homestream@<version>`, source maps uploaded by `@sentry/vite-plugin` in release builds and removed from `dist`), `posthog-js` (slim, manual capture, a `before_send` hook that keeps only catalog events) and the shared sanitizer. API calls go through `apiFetch`, which adds `X-Request-ID`; the small `logger` writes Sentry breadcrumbs.
- The desktop main process uses `@sentry/electron` 8.3 (initialized before `app.ready`, tag `process=main`, same scrubber and DSN) and `posthog-node` for `desktop_started`. Main-process logger entries at info and above become Sentry breadcrumbs of category `main` (the renderer's are `log`). The plan and its options are in [apps/desktop/README.md](../apps/desktop/README.md).
- A web build made with `HOMESTREAM_TELEMETRY_STUB=1` honors `?__telemetry_test=<run id>` and reports one deliberate error. The Playwright suite uses it against local receivers (`pnpm --filter @homestream/web test:e2e`).
- The desktop shell reports one deliberate main-process error when started with `HOMESTREAM_TELEMETRY_TEST=<run id>` (lowercase letters, digits and dashes, at most 40) and `SENTRY_DSN_WEB` set. Otherwise the variable is ignored.
- A React render error in the web UI is caught by an error boundary, which shows a reload card and reports it once through the lazily loaded Sentry chunk (tag `boundary` = `app` or `route`); see [apps/web/README.md](../apps/web/README.md).

### Required account settings

Sentry and PostHog add the sender's IP address (and, for Sentry, a geo location derived from it) when an event reaches them, even though the payload has none. The shared sanitizer marks every Sentry event with `sdk.settings.infer_ip: "never"` plus an empty `user.geo` (`infer_ip` alone does not stop the geo lookup: Relay looks the location up from the connection address whenever `user.geo` is absent, and skips the lookup when it is present; an empty geo is not stored). PostHog events carry `$geoip_disable`. These two settings must also be on (details in [PRIVACY.md](PRIVACY.md#required-account-settings)):

- Sentry: **Prevent Storing of IP Addresses** in Organization Settings > Security & Privacy and in Project Settings > Security & Privacy of every HomeStream project (`scrubIPAddresses`).
- PostHog: **Discard client IP data** in Settings > Project > IP data capture configuration (`anonymize_ips`).

Changing them through the API needs a Sentry token with `org:write` and `project:write`, and a PostHog personal key with the `project:write` scope. A read-only key gets HTTP 403; set the toggles in the web UI instead. Every new Sentry project (web, TV) needs the toggle too.

### Checking that it works

```powershell
pnpm telemetry:smoke --sentry     # one deliberate HomestreamReadinessSmokeError with a unique run id
pnpm telemetry:smoke --posthog    # server_started (version carries the run id) and one playback_started-shaped event (title carries it)
```

The command prints the run id, never exits non-zero for a missing key or an unreachable service, and sends nothing when telemetry is off. Search the run id in Sentry or PostHog to find the report.

## Where to look

| What                                        | Where                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Server errors (project `homestream-server`) | `https://<your-sentry-org>.sentry.io/projects/homestream-server/`                         |
| Web and desktop errors                      | `https://<your-sentry-org>.sentry.io/projects/homestream-web/`                            |
| TV app errors                               | `https://<your-sentry-org>.sentry.io/projects/homestream-tv/`                             |
| Product events and dashboards               | [PostHog dashboards](https://us.posthog.com/project/711768/dashboard)                     |
| Event stream (check a new event arrived)    | [PostHog activity](https://us.posthog.com/project/711768/activity/explore)                |
| Feature flags and experiments               | [PostHog feature flags](https://us.posthog.com/project/711768/feature_flags)              |
| Alert rules                                 | `https://<your-sentry-org>.sentry.io/issues/alerts/rules/` and [alerting.md](alerting.md) |

Replace `<your-sentry-org>` with your Sentry organisation slug, the value of `SENTRY_ORG` in `.env`. The scripts that call the Sentry API (`pnpm sentry:alerts`, `pnpm sentry:issues`) read it from there.

## Profiling

`pnpm profile:server` writes a V8 CPU profile of a throw-away server to `reports/profiles`; see the [profiling runbook](runbooks/profiling.md).
