# Security policy

## Supported versions

HomeStream is pre-1.0. Only the latest commit on `main` and the latest release receive security fixes.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Include what you found, the steps to reproduce it, the version or commit, and the impact you expect. Do not include real API keys, stream URLs or gateway URLs in the report; describe where they appeared instead.

You can expect an acknowledgement within a few days. We will keep you informed while we fix the problem and credit you in the release notes if you want.

## Scope

In scope:

- The server (`apps/server`), the web UI, the desktop shell and the TV app.
- Leaks of secrets or personal data into logs, events, API errors, telemetry or the repository.
- Path traversal or request-handling bugs in `/hls/*` and the API.
- Bypasses of the secret scrubber or the telemetry allow-list.

Out of scope:

- Anyone on your local network can use the server. HomeStream has no accounts or authentication by design and is meant for a trusted local network. Do not expose port 8600 to the internet; exposing it is a configuration problem, not a vulnerability.
- Vulnerabilities in third-party services (TMDB, AIOStreams, TorBox, Sentry, PostHog) or in ffmpeg itself. Report those to their maintainers.
- Findings that need physical or administrator access to the PC that runs the server.

## Secrets

Secrets live in `.env` (ignored by git) or `%APPDATA%\HomeStream\config.env`. If you committed a secret by accident, revoke or rotate it first, then tell us. Removing it from history does not make it safe again. The repository runs a secret scan in the pre-commit hook and in CI.

## What we do

Dependencies are kept current by Dependabot, vulnerable ones are reported by `pnpm audit` in CI, and telemetry is off unless you enable it ([docs/PRIVACY.md](docs/PRIVACY.md)).
