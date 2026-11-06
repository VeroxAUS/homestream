# Runbook: Sentry triage

Sentry receives scrubbed error reports from the server, the web UI and the desktop shell, and the TV app, when a DSN is configured (`SENTRY_DSN_SERVER`, `SENTRY_DSN_WEB`, `SENTRY_DSN_TV`). With no DSN or with `HOMESTREAM_TELEMETRY=off` nothing is sent and this runbook does not apply. What is sent is described in [PRIVACY.md](../PRIVACY.md).

## Symptoms

- A Sentry alert (new issue, regression, or a spike in one issue) arrived.
- A user reports a crash or error and you want to find the matching report.

## Diagnosis

1. Open the issue and note the **project** (server, web, tv), the **release**, the **environment** and how many events and distinct installs it affects. Reports never contain user names, IP addresses, file paths, gateway URLs or stream URLs. If you see one, treat it as a privacy bug (step 4).
2. Decide the severity:
   - **Fix now:** the server crashes or cannot start, playback fails for everyone, or a regression appeared in the newest release.
   - **Fix soon:** one title or one device fails, or an upstream (gateway, TMDB, TorBox) is down. Upstream outages are already visible in the event log and health checks.
   - **Ignore or merge:** an old release, a one-off, or noise from a client extension.
3. Find the same failure on the machine. The server writes its own event log, which carries the same message in more detail:

   ```powershell
   curl.exe "http://localhost:8600/api/logs?level=error&limit=100"
   curl.exe http://localhost:8600/api/health
   ```

4. If a report contains something it should not (a URL, a path, a key): stop. Remove the event in Sentry, rotate the exposed secret, and fix the scrubber (`apps/server/src/redact.ts` for the server) with a regression test before anything else. Record what leaked in the pull request without repeating the value.

## Fix

- Reproduce with a failing test first, fix the code, and mention the issue id in the commit body.
- Resolve the Sentry issue "in next release" only after the fix is on `main`. Do not mute an issue to make an alert quiet unless you wrote down why.
- If the release is the cause, go back with [rollback](rollback.md).
- Operational causes have their own runbooks: [gateway-down](gateway-down.md), [torbox-expired](torbox-expired.md), [encoder-failing](encoder-failing.md), [disk-full-transcode](disk-full-transcode.md).

## Verify

- The failing test now passes (`pnpm test:ci`).
- After the fix ships, the issue shows no new events for the new release for at least a day of normal use.
- `GET /api/logs?level=error` on the server no longer shows the message.
