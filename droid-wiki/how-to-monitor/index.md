# Monitoring

HomeStream has local structured logs, durable events, health snapshots, Prometheus metrics and optional Sentry/PostHog telemetry. Dashboard tabs remain placeholders in `apps/web/src/App.tsx` and `apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`; their names do not imply a deployed monitoring UI. See [health](../systems/health.md).

## Choose a signal

| Question                        | Surface                                        | Boundary                                                                        |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------- |
| Is HTTP answering?              | GET `/healthz`                                 | Liveness only                                                                   |
| Can local state be used?        | GET `/readyz`                                  | DB query and data-directory write/remove; 503 when unusable, 300/minute/address |
| Can dependencies/playback work? | GET `/api/health`                              | Nine checks, scheduled/cached; initial read can be expensive                    |
| What happened to a request?     | Response `X-Request-ID`, `DATA_DIR/server.log` | Local correlation, not automatic distributed tracing                            |
| Which domain events occurred?   | GET `/api/logs`                                | Selected SQLite events, not process log contents                                |
| What changed now?               | GET `/api/events`                              | SSE session/health/log/download changes, not general history replay             |
| What rates/latencies exist?     | GET `/metrics`                                 | Needs an external scraper/time-series backend                                   |
| What is playing?                | GET `/api/activity`, GET `/api/sessions/:id`   | Current session/encoder snapshots                                               |

`registerOpsRoutes` in `apps/server/src/routes/ops.ts` makes no upstream calls. `/healthz` returns `{"status":"ok"}`; successful readiness returns `{"status":"ready"}`. Readiness does not test GPU, transcode writes, source availability or credentials.

`HealthService` in `apps/server/src/health/service.ts` can contact services and run an NVENC encode. Normal server startup schedules full passes every **60 seconds** and cheap session/network refreshes every **five seconds**; constructing the Fastify app alone does not start those timers (`apps/server/src/index.ts`). Use the root probes for frequent polling; a failed dependency changes snapshot status rather than automatically failing HTTP liveness. Do not repeatedly invoke fresh health runs.

`registerEventRoutes` in `apps/server/src/routes/events.ts` sends heartbeat immediately and every 15 seconds, with a three-second retry hint, but no health baseline or general replay cursor. `apps/web/src/events/serverEvents.ts` reconciles health via its query on every open and cancels stale answers. Reconnecting consumers should refetch the snapshots they need.

## Guides

- [Logging](logging.md): process files, retained event rows, SSE and local privacy.
- [Metrics](metrics.md): literal metric families, labels and scrape exclusions.
- [Tracing](tracing.md): request IDs and restricted Sentry instrumentation.
- [Alerting](alerting.md): checked-in thresholds, Sentry workflows and runbooks.
- [Health](../systems/health.md): check timing, caches, disk setting and failure boundaries.
- [Telemetry](../systems/telemetry.md): outbound events, opt-outs and flags.

[Observability](../../docs/observability.md), [alert rules](../../docs/alerting.md), [privacy](../../docs/PRIVACY.md) and [runbooks](../../docs/runbooks/README.md) are maintained operator references. Configuration under `monitoring/prometheus/` and `monitoring/sentry/` does not prove a scraper, receiver or account rule has been deployed. [Configuration](../reference/configuration.md) separates server restart-time values, renderer build-time keys and local preferences.

These endpoints share the unauthenticated LAN boundary. Keep snapshots/logs private and review before sharing; see [security](../security.md). This **2026-11-08** source snapshot at **`0a8f04f`** did not probe services, apply alerts or execute application test suites.
