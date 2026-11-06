# Runbooks

Step-by-step procedures for the problems you are most likely to meet. Every runbook has the same four parts: **Symptoms**, **Diagnosis**, **Fix**, **Verify**. They only use endpoints and commands that exist in this repository (the API is listed in [docs/openapi.json](../openapi.json) and at `/api/docs` while the server runs).

| Runbook                                       | Use it when                                                          |
| --------------------------------------------- | -------------------------------------------------------------------- |
| [gateway-down](gateway-down.md)               | Search finds no streams, or the gateway health check is red          |
| [torbox-expired](torbox-expired.md)           | TorBox subscription expired, key rejected, or downloads never finish |
| [ffmpeg-orphans](ffmpeg-orphans.md)           | ffmpeg processes keep running after the server stopped or crashed    |
| [disk-full-transcode](disk-full-transcode.md) | Playback stalls or fails because the transcode drive is full         |
| [encoder-failing](encoder-failing.md)         | Sessions end in `encoder_failed`, or the GPU check is red            |
| [sentry-triage](sentry-triage.md)             | A Sentry alert fired and you need to decide what to do               |
| [flaky-tests](flaky-tests.md)                 | A test passes on retry or fails only sometimes                       |
| [rollback](rollback.md)                       | A change broke the server and you need the last good version back    |
| [profiling](profiling.md)                     | Something is slow and you need numbers before changing code          |

## First minute for any server problem

The server keeps an event log that explains most failures in plain English. These commands work from a PowerShell prompt on the server PC (use `curl` instead of `curl.exe` on Linux or macOS).

```powershell
curl.exe http://localhost:8600/api/health
curl.exe "http://localhost:8600/api/logs?level=error&limit=50"
curl.exe http://localhost:8600/api/activity
```

- `/api/health` lists nine checks (`config`, `gateway`, `torbox`, `tmdb`, `ffmpeg`, `gpu`, `disk`, `sessions`, `network`). Each non-`ok` check carries a `hint` that says what to do.
- `/api/logs` returns the stored event log. Filter with `level` (`info`, `warn`, `error`), `source` (`gateway`, `tmdb`, `torbox`, `ffmpeg`, `session`, `health`, `server`, `prefetch`, `downloads`) and `limit` (1 to 1000).
- `/api/activity` lists the sessions that are playing right now.
- `/healthz` answers 200 while the process is up; `/readyz` answers 200 when the database and the data directory work and 503 with a plain-English reason when they do not. Neither calls an external service.
- `/metrics` is the Prometheus scrape endpoint (see [observability](../observability.md) and [alerting](../alerting.md)). Every response has an `X-Request-ID` header; search `server.log` for that value in the `reqId` field to see everything the server did for the request.
- The same text goes to `server.log` in `DATA_DIR` (see [.env.example](../../.env.example)).

If the server does not answer at all, start it in a visible terminal (`pnpm --filter @homestream/server start`) and read what it prints. Configuration problems are reported at startup with the key that is missing.

## Rules for editing runbooks

- Keep the four headings. Keep commands copy-pasteable.
- Mention only real endpoints and `pnpm` scripts. `pnpm agents:check` verifies this for every file in this folder.
- Never paste a gateway URL, stream URL, API key or IP address into a runbook.
