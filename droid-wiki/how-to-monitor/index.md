# Monitoring

HomeStream has local JSON logs, persisted domain events, health snapshots, Prometheus metrics and optional Sentry/PostHog clients. The surfaces answer different questions; none is a finished web monitoring dashboard (`apps/server/src/routes/ops.ts`, `apps/server/src/routes/health.ts`, `apps/web/src/App.tsx`).

## Start with the right signal

| Need                               | Surface                                      | Limits                                                                                      |
| ---------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Is HTTP answering?                 | `GET /healthz`                               | Liveness only                                                                               |
| Can local state be used?           | `GET /readyz`                                | SQLite query plus temporary data-directory write/delete; 503 on failure, 300/minute/address |
| Are dependencies/playback healthy? | `GET /api/health`                            | Nine checks; upstream/GPU checks have scheduling/caching                                    |
| Follow a request                   | `X-Request-ID` and `DATA_DIR` process log    | Context correlation, not distributed tracing                                                |
| Find domain failures               | `GET /api/logs?level=error`                  | SQLite events, not full process log                                                         |
| Watch changes                      | `GET /api/events`                            | SSE heartbeat, health, session, log and download events; not general replay                 |
| Graph rates/latency                | `GET /metrics`                               | Requires an external scraper/backend                                                        |
| Inspect live playback              | `GET /api/activity`, `GET /api/sessions/:id` | Session/encoder snapshots, not retained time series                                         |

Probe/metrics routes make no upstream calls (`apps/server/src/routes/ops.ts`). Reading `/api/health` can run all checks before the first snapshot, including an NVENC encode; use the dedicated probes for frequent polling (`apps/server/src/health/service.ts`). Public routes are open on the configured LAN listener; keep them off the internet.

## Guides

- [Logging](logging.md): process logs, domain events, SSE and request IDs.
- [Metrics](metrics.md): labels, buckets, metric families and scrape configuration.
- [Tracing](tracing.md): actual correlation and the limits of manual Sentry setup.
- [Alerting](alerting.md): checked-in Prometheus rules and Sentry workflows.
- [Health](../systems/health.md): check thresholds, scheduling and fresh-run costs.
- [Telemetry](../systems/telemetry.md): optional outbound data and flag defaults.

`docs/observability.md`, `docs/alerting.md`, `docs/PRIVACY.md` and `docs/runbooks/README.md` are the maintained operator references. Backend configuration is checked in under `monitoring/prometheus/` and `monitoring/sentry/`; their presence does not prove a backend is deployed or a rule applied.
