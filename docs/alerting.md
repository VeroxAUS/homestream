# Alerting

What raises an alarm, where the rules live and how to change them. For the signals themselves see [observability.md](observability.md); for what to do when one fires see the [runbooks](runbooks/README.md).

## Sentry alerts

Rules live in `monitoring/sentry/alert-rules.json` and are applied with `scripts/sentry-alerts.mjs`:

```powershell
pnpm sentry:alerts --dry-run   # print the rules in the file that --apply would create or update; never calls Sentry
pnpm sentry:alerts --apply     # make Sentry match the file; safe to repeat
```

`--apply` uses `SENTRY_API_TOKEN` (the personal token with `alerts:read` and `alerts:write`) from `.env` or the environment, and `SENTRY_ORG`. The organisation token `SENTRY_AUTH_TOKEN` cannot manage alerts. `--dry-run` needs neither: it validates the rules file and prints each rule without any network call, even when a token is set, so it cannot say which rules Sentry already has. `--apply` reports that per rule.

This organisation uses Sentry's workflow-based alerting. The older alert-rule endpoints (`/projects/{org}/{project}/rules/` and `/organizations/{org}/alert-rules/`) answer 404, so the script talks to `/organizations/<your-sentry-org>/workflows/` (alerts) and `/organizations/<your-sentry-org>/detectors/` (monitors) at `https://sentry.io/api/0/`. Items are matched by name and project, so applying twice changes nothing the second time: a missing workflow is created, a workflow that drifted is updated, the rest is left alone.

| Alert                                       | Fires when                                                                                | Goes to                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ |
| `HomeStream server: new or returning issue` | A server issue is seen for the first time, regresses or comes back (at most once an hour) | Email to the issue owners or members |
| `HomeStream server: issue repeating`        | A high-priority server issue has at least 20 events in an hour (at most every 6 hours)    | Email to the issue owners or members |

The monitor `Error Monitor` of `homestream-server` must exist and be enabled. The personal token can read monitors but Sentry does not let it create or change them, so a missing or disabled monitor is reported as work to do in the Sentry UI. Add a notification channel (Slack, PagerDuty) to a workflow in the Sentry UI if you want one; the script keeps the actions it was given, so put the channel in `alert-rules.json` as well to keep it.

## Prometheus alerts

`monitoring/prometheus/alerts.yml` holds the rules for a Prometheus that scrapes `GET /metrics` (setup: `monitoring/prometheus/prometheus.yml`). Every metric in it exists in the server; a test fails if a rule uses a name that `/metrics` does not expose.

| Alert                            | Condition                                                          | Severity |
| -------------------------------- | ------------------------------------------------------------------ | -------- |
| `HomeStreamDown`                 | Scrape fails for 2 minutes                                         | critical |
| `HomeStreamHigh5xxRate`          | More than 5 % of requests answer 5xx for 5 minutes                 | warning  |
| `HomeStreamSlowRequests`         | p95 request duration above 2 s for 10 minutes                      | warning  |
| `HomeStreamEventLoopLag`         | `nodejs_eventloop_lag_p99_seconds` above 0.5 for 5 minutes         | warning  |
| `HomeStreamMemoryHigh`           | Process memory above 1.5 GB for 15 minutes                         | warning  |
| `HomeStreamPlaybackFailures`     | More than 3 failed sessions in 15 minutes                          | warning  |
| `HomeStreamEncoderTooSlow`       | A live session encodes slower than real time for 2 minutes         | warning  |
| `HomeStreamEncoderRestartLoop`   | More than 5 error-recovery restarts in 10 minutes                  | warning  |
| `HomeStreamGatewayErrors`        | More than half of gateway lookups fail for 10 minutes              | warning  |
| `HomeStreamTmdbErrors`           | More than half of TMDB requests fail for 10 minutes                | warning  |
| `HomeStreamSourceProxyCacheCold` | More than 95 % of source proxy reads miss the cache for 30 minutes | info     |

Check a rules file with `promtool check rules monitoring/prometheus/alerts.yml` when promtool is installed. Disk space of the transcode drive is not a Prometheus metric: it is the `disk` check of `GET /api/health` and the [disk-full runbook](runbooks/disk-full-transcode.md).

## Responding

| Alert                                                               | Runbook                                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| New issue, issue repeating                                          | [sentry-triage](runbooks/sentry-triage.md)                                        |
| `HomeStreamGatewayErrors`                                           | [gateway-down](runbooks/gateway-down.md)                                          |
| `HomeStreamEncoderTooSlow`, `...RestartLoop`, `...PlaybackFailures` | [encoder-failing](runbooks/encoder-failing.md)                                    |
| `HomeStreamSlowRequests`, `...EventLoopLag`, `...MemoryHigh`        | [profiling](runbooks/profiling.md)                                                |
| `HomeStreamDown`                                                    | [ffmpeg-orphans](runbooks/ffmpeg-orphans.md) and [rollback](runbooks/rollback.md) |
