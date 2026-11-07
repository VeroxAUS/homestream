# Security

Active contributors: VeroxAUS

HomeStream trusts its local network and host. These are implemented boundaries, not an internet-readiness claim or a new security audit. `SECURITY.md` defines private reporting and supported versions; see [deployment](deployment.md).

## LAN trust is policy, not authentication

`buildApp` in `apps/server/src/app.ts` uses wildcard CORS and no account/authentication layer. `apps/server/src/config.ts` defaults to a wildcard listener; there is no configured TLS listener. Anyone reaching it can invoke catalog, playback, device, download, progress/history, health and event APIs.

Device registration records identity/capabilities and caller address, not proof of identity (`apps/server/src/routes/devices.ts`). CORS and allowed `Authorization`/trace headers do not add access control. Address ranking for discovery in `apps/server/src/net.ts` is not an inbound firewall. Keep the service on a trusted LAN, restrict the host firewall and do not port-forward it.

`SourceProxy` in `apps/server/src/sourceproxy/proxy.ts` binds loopback and serves registered sources through randomized `/src/<key>` identifiers. It is not a public arbitrary-URL endpoint or a replacement for authentication. See [source proxy](systems/source-proxy.md).

## Upstream and process trust

`SessionStartRequestSchema` in `packages/shared/src/playback.ts` accepts title identity and capabilities, not arbitrary caller media URLs. `StreamService` in `apps/server/src/streams/service.ts` resolves gateway records and public options omit raw source URLs.

The configured gateway and redirects remain trusted inputs. `createUrlResolver` in `apps/server/src/playback/resolveUrl.ts` uses range probes with a 60-second overall timeout and eight-redirect budget, but has no destination-host allowlist/private-address denylist. Loopback proxy binding alone is not comprehensive SSRF protection against malicious upstream data.

FFmpeg/ffprobe use executable paths and argument arrays rather than shell interpolation (`apps/server/src/playback/encoderProcess.ts`, `apps/server/src/playback/probe.ts`). They run with the server user's privileges, not inside a sandbox. Binary paths, configuration, output directories and local host access are trusted; no claim here audits FFmpeg itself.

## Input and resource boundaries

| Boundary | Implementation | Constraint |
| --- | --- | --- |
| JSON/query input | `packages/shared/src/`, `apps/server/src/routes/` | Explicit shared Zod parsing in handlers |
| Catalog IDs | `apps/server/src/routes/params.ts` | Bounded decimal forms and safe integer minima |
| HLS files | `apps/server/src/playback/playlist.ts` | Named playlists/init and bounded numeric segment/track forms |
| Session media | `apps/server/src/playback/hlsServing.ts` | Session lookup and parsed file kind, not arbitrary paths |
| Database | `apps/server/src/db/` | Bound prepared-statement inputs |
| Request ID | `apps/server/src/requestContext.ts` | 1–64 safe characters or generated UUID |
| Readiness | `apps/server/src/routes/ops.ts` | 300 requests/minute/address for write probing |

OpenAPI metadata does not replace runtime handler validation or automatically serialize responses (`apps/server/src/docs/openapi.ts`). `AppError`/`errorBody` in `apps/server/src/errors.ts` redact actionable errors; unexpected failures become generic 500s.

Readiness limiting is opt-in for that route, not blanket API throttling. Playback session, cache, bandwidth and memory limits are resource controls rather than tenant isolation. See [API](api/index.md) and [network](systems/network.md).

## Electron renderer boundary

`createMainWindow`/`createMiniWindow` in `apps/desktop/src/shell/windows.ts` enable sandboxing/context isolation and disable Node integration. The preload in `apps/desktop/src/preload.cts` exposes named capabilities, not arbitrary IPC or filesystem access.

`registerIpc` in `apps/desktop/src/ipc.ts` validates arguments and the sending frame's URL against the exact loopback origin or bundled startup page. This is URL-based trust, not per-window authorization: same-origin frames are not separately excluded. Navigation outside trusted URLs is blocked; new windows are denied, with approved HTTPS links opened externally. The default session permits fullscreen only.

Keep the trusted renderer/server boundary aligned with LAN exposure. See [windows and IPC](apps/desktop/windows-and-ipc.md) for handoff and sender limitations, rather than treating the bridge as a separate account system.

## Secrets and private local state

Keep keys in ignored `.env` or app-data `config.env`, never tracked files. `registerConfigSecrets` in `apps/server/src/config.ts` registers credentials with `redact` in `apps/server/src/redact.ts`. Structured Pino fields and complete serialized lines are scrubbed; persisted event messages/details, bus payloads, API errors and event reads have their own redaction boundaries.

Do not rely on pattern matching to justify logging raw request bodies, signed URLs or credentials. Local scrubbing is not complete anonymization of paths/device names. Databases retain device names/addresses, viewing history/progress and gateway caches containing source URLs (`apps/server/src/gateway/cache.ts`). Treat data directories, backups, logs and CPU profiles as private. These modules provide no user accounts or storage encryption.

Fixtures use invented tokens, `example.test` and documentation addresses. Revoke/rotate a leaked credential first; deleting it from a patch does not restore safety.

## Optional outbound telemetry

`createTelemetry` in `apps/server/src/telemetry/index.ts` enables matching clients only with keys; `HOMESTREAM_TELEMETRY=off` overrides them. Browser keys are build-time, with a per-browser storage opt-out. Desktop initializes main clients before readiness in `apps/desktop/src/main.ts`; it is no longer an unwired helper.

`sanitizeSentryEvent` in `packages/shared/src/sanitize.ts` removes identity/request data, scrubs addresses/tokens/URLs and relativizes configured stack roots. It explicitly sets `sdk.settings.infer_ip: "never"` and `user: { geo: {} }`; the empty geo suppresses ingestion fallback lookup and must remain.

`sanitizeEventProperties` in `packages/shared/src/analytics.ts` permits only typed catalog properties. **Scrubbed TMDB media titles are the sole allowed free text**, not user-entered text. Enabled playback analytics can reveal media IDs/titles; anonymous identity does not mean content-free data.

Account controls still matter: Sentry **Prevent Storing of IP Addresses** and PostHog **Discard client IP data** must be enabled and stored events checked. No account state or remote payload was verified here. See [telemetry](systems/telemetry.md) and `docs/PRIVACY.md`.

## Repository defenses and reporting

`scripts/pre-commit-secrets.mjs` scans staged additions/blocked paths, uses Gitleaks when available and otherwise built-in patterns, and compares eligible local configuration literals without printing values. It is not a complete full-history scanner; fixture allowances are not permission to hide real secrets. `.gitleaks.toml` holds custom rules.

| Automation | Scope |
| --- | --- |
| `lefthook.yml` | Staged secret scan and quality hooks |
| `.github/workflows/ci.yml` | Linux full-history redacted Gitleaks scan |
| `.github/workflows/gitleaks.yml` | Push/PR, weekly and manual history scans |
| `.github/workflows/codeql.yml` | JavaScript/TypeScript security-and-quality analysis |
| `.github/dependabot.yml` | Weekly dependency/action updates |

Wiki-only push/PR exclusions do not remove separate scheduled/manual security runs. Source workflow declarations are not proof that branch protection or external security settings are applied. In particular, the current CI file has no `pnpm audit` step despite that statement in `SECURITY.md`.

Report privately through GitHub Security's vulnerability reporting, with commit/version and safe reproduction details, never live secrets. Policy supports latest main/latest release; old pre-1.0 versions do not receive security fixes. Leaks and path traversal are in scope; deliberate trusted-LAN access without accounts is a documented design boundary, not a hidden login feature. See [debugging](how-to-contribute/debugging.md).
