# Alerting

HomeStream checks in Prometheus expressions and Sentry workflow definitions. Prometheus must load its rules and Sentry workflows must be applied separately; checked-in configuration is not proof of deployed monitoring (`monitoring/prometheus/alerts.yml`, `monitoring/sentry/alert-rules.json`).

## Prometheus thresholds

The following conditions are literal rules from `monitoring/prometheus/alerts.yml`. A lookback such as `[5m]` computes the value; `for` is the additional time that condition must remain true.

| Alert                            | Condition/window                                        | `for` | Severity |
| -------------------------------- | ------------------------------------------------------- | ----- | -------- |
| `HomeStreamDown`                 | `up{job="homestream"} == 0`                             | 2m    | critical |
| `HomeStreamHigh5xxRate`          | 5xx fraction of instrumented requests over 5m **>0.05** | 5m    | warning  |
| `HomeStreamSlowRequests`         | Histogram p95 using 5m rates **>2 s**                   | 10m   | warning  |
| `HomeStreamEventLoopLag`         | `nodejs_eventloop_lag_p99_seconds >0.5`                 | 5m    | warning  |
| `HomeStreamMemoryHigh`           | Node process resident bytes **>1.5e9**                  | 15m   | warning  |
| `HomeStreamPlaybackFailures`     | Sum of failed-session increases over 15m **>3**         | None  | warning  |
| `HomeStreamEncoderTooSlow`       | Active sessions **>0** and minimum speed **<1**         | 2m    | warning  |
| `HomeStreamEncoderRestartLoop`   | Retry-restart increase over 10m **>5**                  | None  | warning  |
| `HomeStreamGatewayErrors`        | Gateway error/request rate ratio over 10m **>0.5**      | 10m   | warning  |
| `HomeStreamTmdbErrors`           | TMDB error/request rate ratio over 10m **>0.5**         | 10m   | warning  |
| `HomeStreamSourceProxyCacheCold` | Proxy miss fraction over 15m **>0.95**                  | 30m   | info     |

Ratio denominators are clamped to **0.001**. HTTP and playback/restart rules use sums where shown; upstream/cache ratios are per exported target series. Most rules lack a `job` selector, so retain sensible scrape labels/rule scope if monitoring multiple servers. These are configured warning boundaries, not a formally documented SLO.

`monitoring/prometheus/prometheus.yml` supplies a 30-second scrape and loads the rule file. It has no Alertmanager destination or notification receiver. Run `promtool check rules monitoring/prometheus/alerts.yml` when promtool is available. The integration test verifies referenced server metric names, not real delivery (`apps/server/test/integration/monitoringFiles.test.ts`).

## Interpretation and likely noise

The encoder rule reads the raw minimum speed and does not exclude sessions waiting at the read-ahead limit. The [health](../systems/health.md) detector instead requires positive sub-real-time speed while filling for over 30 seconds. Treat this difference as a possible source of misleading slow-encoder alerts, not a verified production incident.

Cold caches during new-title playback can explain cache-miss alerts; check [source proxy](../systems/source-proxy.md) before treating misses as failure. Node process memory is separate from the per-FFmpeg **4096 MiB** watchdog default (`apps/server/src/playback/memoryWatchdog.ts`). Disk free space, GPU temperature and download-cap warnings are health checks, not Prometheus alert families.

HTTP ratios omit HLS/probe/SSE paths, so a green request-latency alert does not prove smooth playback. See [metrics](metrics.md) for collection exclusions and labels.

## Sentry workflows

`monitoring/sentry/alert-rules.json` defines two enabled `homestream-server` workflows, without an environment filter:

| Workflow                                    | Trigger/action                                                                                | Notification frequency       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------- |
| `HomeStream server: new or returning issue` | First seen, regression or reappearance; email issue owners, falling through to active members | At most once per 60 minutes  |
| `HomeStream server: issue repeating`        | New/existing high-priority issue, with event-frequency threshold 20 in 1h; same email action  | At most once per 360 minutes |

The expected enabled detector is `Error Monitor`; workflows reference `Issue Stream`. `scripts/sentry-alerts.mjs` uses Sentry's workflow/detector APIs rather than legacy alert-rule endpoints. It matches by name/project, creates missing workflows, updates drifted ones and leaves unrelated items alone. Missing/disabled monitors require Sentry UI action; the script cannot create/change them with its personal token.

```text
pnpm sentry:alerts --dry-run
pnpm sentry:alerts --apply
```

**Dry-run always stays offline**, even if credentials are present: it validates and prints the checked-in definitions without reading deployed rules. Apply needs `SENTRY_ORG` and personal `SENTRY_API_TOKEN` with `alerts:read`/`alerts:write`, from the repository env file or process environment (`scripts/sentry-alerts.mjs`). An organization release token (`SENTRY_AUTH_TOKEN`) is different. Without the personal token, apply returns failure without contacting Sentry. Keep the real organization slug out of tracked rules. See [configuration](../reference/configuration.md).

Slack/PagerDuty channels are not provisioned here. Add actual workflow actions and keep the JSON in sync rather than assuming an escalation chain exists. The daily issue-sync workflow copies unresolved Sentry issues into GitHub, deduplicates by short ID and skips deliberate smoke errors; it is not paging (`scripts/sentry-issues.mjs`, `.github/workflows/sentry-issues.yml`).

## Response and modification

Maintained procedures are `docs/runbooks/sentry-triage.md`, `docs/runbooks/gateway-down.md`, `docs/runbooks/encoder-failing.md`, `docs/runbooks/profiling.md`, `docs/runbooks/disk-full-transcode.md`, `docs/runbooks/ffmpeg-orphans.md` and `docs/runbooks/rollback.md`. There is no checked-in on-call rota or timed escalation ladder.

Change conditions in the checked-in rules, confirm each metric exists, validate syntax and review local [logging](logging.md)/health evidence before applying external changes. This wiki generation did not apply rules or test live notification delivery.

## Key source files

| File                                                          | Purpose                                            |
| ------------------------------------------------------------- | -------------------------------------------------- |
| `monitoring/prometheus/alerts.yml`                            | Eleven exact Prometheus conditions                 |
| `monitoring/prometheus/prometheus.yml`                        | Example scrape/rule loading                        |
| `monitoring/sentry/alert-rules.json`                          | Detector expectation and workflow actions          |
| `scripts/sentry-alerts.mjs`                                   | Validate/plan/apply Sentry workflows               |
| `scripts/sentry-issues.mjs`                                   | Sentry-to-GitHub issue sync                        |
| `apps/server/test/integration/monitoringFiles.test.ts`        | Alert metric names and maintained-doc drift checks |
| `apps/server/test/integration/playback-observability.test.ts` | Playback lifecycle metrics and reports             |
| `docs/alerting.md`                                            | Maintained thresholds and runbook mapping          |
