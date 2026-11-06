# Security

Active contributors: VeroxAUS

HomeStream trusts the local network and the PC running it. This page describes implemented boundaries and privacy controls, not an internet-readiness claim or a new security audit; `SECURITY.md` defines reporting and support policy.

## Network trust boundary

`apps/server/src/config.ts` binds the public service to `0.0.0.0`; `apps/server/src/app.ts` allows wildcard CORS for API/media use. There are no accounts, authentication checks, authorization roles or configured TLS listener. Device registration stores identity/capabilities and caller IP; it does not prove who a caller is (`apps/server/src/routes/devices.ts`).

Anyone who can reach the listener can use its catalog, device, playback, progress/history, downloads, health and event routes. CORS and `Authorization` appearing in the allowed-header list are not access control. Do not port-forward 8600 or expose it to untrusted networks. Local health/metrics may reveal operational state even without making external calls.

The separate `SourceProxy` in `apps/server/src/sourceproxy/proxy.ts` binds `127.0.0.1`, accepts GET/HEAD, and looks up randomized `/src/<key>` identifiers registered for existing sources. It is not a public arbitrary-URL proxy or a public authentication layer. Keep it loopback-only; [source proxy](systems/source-proxy.md) and [network controls](systems/network.md) explain byte-cache and resource limits.

## Validate before acting

| Boundary                | Implementation                                                              | Constraint                                                          |
| ----------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| JSON bodies and queries | `packages/shared/src/`, `apps/server/src/routes/`                           | Shared Zod field/range validation before service calls              |
| Catalog identifiers     | `apps/server/src/routes/params.ts`                                          | Bounded decimal strings, safe integers and per-field minima         |
| HLS names               | `apps/server/src/playback/playlist.ts`                                      | Only named playlists/init and bounded numeric segment/track names   |
| Session output          | `apps/server/src/routes/sessions.ts`, `apps/server/src/playback/manager.ts` | Session lookup and parsed file kind, not arbitrary filesystem paths |
| Database inputs         | `apps/server/src/db/`                                                       | Prepared statements with bound values                               |
| Request ID              | `apps/server/src/requestContext.ts`                                         | At most 64 safe characters or a new UUID                            |
| Readiness probe         | `apps/server/src/routes/ops.ts`                                             | Per-address 300/minute limit on filesystem probing                  |

`parseHlsFileName` in `apps/server/src/playback/playlist.ts` accepts `index.m3u8`, `video.m3u8`, `init.mp4`, or `seg-<1–7 digits>.ts/.m4s`. Complete subtitle names have 1–4 numeric digits plus `.vtt`; segment names have 1–7 numeric digits. Subtitle path indices have their own 1–4 digit check. These constraints are part of the path-traversal boundary.

Swagger schemas are documentation-only, not a replacement for handler validation (`apps/server/src/docs/openapi.ts`). `AppError` and `errorBody` in `apps/server/src/errors.ts` preserve actionable expected failures with redaction; unexpected server exceptions return generic 500s (`apps/server/src/app.ts`). See [API](api/index.md).

Readiness rate limiting is narrowly enabled; the server does not apply a blanket authentication or request-throttling policy to playback/HLS. Session, bandwidth, memory and cache limits are resource controls, not tenant isolation.

## Secrets and local data

Keep credentials in ignored `.env` or app-data configuration, never in tracked files. `registerConfigSecrets` in `apps/server/src/config.ts` registers gateway URL components, TMDB/TorBox keys, Sentry DSN and PostHog key with the redactor.

`apps/server/src/redact.ts` applies longest-first registered-literal replacement, encoded variants, gateway-path patterns, common secret query fields, bearer/JWT forms and recognized CDN URLs/hosts. It does not register literals shorter than six characters. `displayGatewayUrl` returns a fixed redacted label rather than a user's gateway host.

Redaction exists at several boundaries:

- `apps/server/src/logger.ts` filters structured Pino fields and the final serialized line.
- `apps/server/src/events/record.ts` scrubs event messages/details before SQLite storage.
- `apps/server/src/events/bus.ts` scrubs payloads before subscribers receive them.
- `apps/server/src/events/query.ts` scrubs stored rows again on retrieval.
- `apps/server/src/errors.ts` scrubs API error text.

These defenses do not authorize logging raw payloads. Local databases retain device names/IPs, viewing history/progress and upstream caches; cached gateway data can contain source URLs (`apps/server/src/db/devices.ts`, `apps/server/src/db/history.ts`, `apps/server/src/gateway/cache.ts`). Treat the data directory, backups, logs and CPU profiles as private. Application-level accounts or storage encryption are not provided by these modules. See [data models](reference/data-models.md).

Use `example.test`, invented tokens and documentation IP ranges in fixtures. A leak must be revoked/rotated first; deleting it from a patch or history does not make it safe again (`SECURITY.md`).

## Optional telemetry

`apps/server/src/telemetry/index.ts` is a no-op without the relevant key; `HOMESTREAM_TELEMETRY=off` disables it even when keys exist. Sentry errors and PostHog analytics have separate enablement. Telemetry must not throw into callers or block requests/playback.

`packages/shared/src/sanitize.ts` strips URLs, IPs, tokens, denied identity/auth fields and request data; stack paths are made relative before scrubbing. Server-specific registered-secret scrubbing feeds the shared sanitizer (`apps/server/src/telemetry/scrub.ts`). `packages/shared/src/analytics.ts` defines typed events and allowlisted properties; a random install ID is used rather than accounts.

Sentry disables HTTP/framework/database auto-instrumentation, automatic console capture and sessions (`apps/server/src/telemetry/sentry.ts`). Do not infer full automatic distributed tracing from the SDK dependency. No autocapture/session recording or free-form user data belongs in analytics. New events require the catalog, privacy docs and tests in the same change (`docs/PRIVACY.md`, `.factory/skills/homestream-telemetry/SKILL.md`).

The [web](apps/web.md), desktop and TV are not all implemented telemetry clients merely because the configuration/policy reserves names. See [telemetry](systems/telemetry.md).

## Patch and dependency defenses

`scripts/pre-commit-secrets.mjs` scans staged additions and blocked paths. It uses Gitleaks when available, otherwise built-in patterns, and always compares suitable local config values literally. It checks repository `.env`, `.env.local`, `HOMESTREAM_ENV_FILE`, and app-data config without printing secret values.

Blocked paths include non-example `.env` files, private-key/keystore extensions and `.log` files. `GITLEAKS_PATH` can select the binary; findings report rule/file/line, not matched secrets. `.gitleaks.toml` holds matching custom rules and narrowly scoped fixture allowances. Update fallback patterns and Gitleaks rules together. A fake-value allow marker is not permission to hide a real key.

| Automation                       | Scope                                                                     |
| -------------------------------- | ------------------------------------------------------------------------- |
| `lefthook.yml`                   | Staged secret scan and other pre-commit gates                             |
| `.github/workflows/ci.yml`       | Full-history redacted Gitleaks scan on Linux                              |
| `.github/workflows/gitleaks.yml` | Push/PR, weekly and manual full-history scans                             |
| `.github/workflows/codeql.yml`   | JavaScript/TypeScript security-and-quality analysis                       |
| `.github/dependabot.yml`         | Weekly npm and action updates, with coordinated TypeScript-version policy |

These tools are defenses, not proof of no vulnerabilities. The current CI workflow does not contain a `pnpm audit` step, despite that statement in `SECURITY.md`; use the checked-in workflow for the actual gate list.

## Report privately

Use GitHub Security → Report a vulnerability, with affected commit/version, reproduction and expected impact. Do not include live keys or signed URLs. `SECURITY.md` supports the latest `main` commit and latest release; pre-1.0 older versions do not receive security fixes. The policy expects acknowledgement within a few days.

Leaks into logs/events/errors/telemetry and HLS path traversal are in scope. Deliberate LAN access without accounts is the documented design boundary, not a missing login bug. For operational recovery, see [debugging](how-to-contribute/debugging.md) and [deployment](deployment.md).

## Key source files

| File                                   | Purpose                                              |
| -------------------------------------- | ---------------------------------------------------- |
| `SECURITY.md`                          | Private reporting, supported versions and scope      |
| `apps/server/src/app.ts`               | Listener application policy, CORS and error handling |
| `apps/server/src/sourceproxy/proxy.ts` | Loopback-only source access                          |
| `apps/server/src/playback/playlist.ts` | HLS filename constraints                             |
| `apps/server/src/redact.ts`            | Registered and patterned secret removal              |
| `packages/shared/src/sanitize.ts`      | Cross-client telemetry privacy filter                |
| `scripts/pre-commit-secrets.mjs`       | Staged pattern/literal/path scanner                  |
| `.gitleaks.toml`                       | Full-history custom rules and fixture allowances     |
