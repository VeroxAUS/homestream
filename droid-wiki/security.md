# Security boundary

HomeStream is an unauthenticated trusted-LAN server. This page describes implemented boundaries and handling, not a security audit or a claim of internet readiness. See [running built HomeStream](deployment.md).

## Listener and browser access

`apps/server/src/config.ts` fixes the public host at `0.0.0.0`. `apps/server/src/app.ts` registers wildcard CORS (`origin: '*'`) for GET, HEAD, POST, PUT, PATCH, DELETE, and OPTIONS. No account login, API authentication, authorization roles, or built-in HTTPS setup is present.

Any caller that can reach the public listener can use the implemented device, catalog, session, activity, prefetch, and event routes. CORS is not access control, and device IDs are capability/identity data rather than credentials. Do not port-forward this listener or describe it as safe for untrusted networks.

The internal source proxy binds `127.0.0.1`, with random per-source keys and GET/HEAD-only handling (`apps/server/src/sourceproxy/proxy.ts`). Those keys identify local byte consumers; they do not protect the separate public API. Keep the loopback proxy internal.

## Credentials and redaction

`apps/server/src/config.ts` registers gateway URL secrets, TMDB token, and optional TorBox key. `apps/server/src/redact.ts` redacts registered values, gateway path components, common secret query parameters, bearer tokens, JWT-like strings, and recognized CDN URLs. Registered literal secrets shorter than six characters are not added to its registry.

`apps/server/src/logger.ts` combines Pino field redaction with whole-line filtering. Error envelopes, bus payloads, and persisted event details also use redaction. These are defensive filters, not permission to log raw credentials or arbitrary signed URLs.

Keep configuration files and diagnostic captures private. Review redacted output before sharing; do not publish local databases, media URLs, device names/IPs, or viewing history.

## Validation and stored data

Shared Zod schemas validate public bodies; route parsers constrain identifiers and HLS filenames. Database helpers use prepared statements. Unexpected 500 responses hide internal details (`apps/server/src/app.ts`).

SQLite persists device identities, client IPs, playback details, caches, and operational events. Gateway cache data can contain upstream source URLs even though stream-list responses omit them. Local filesystem access is therefore part of the trust boundary. There is no application-level encrypted storage or user-isolation layer documented by these implementations.

Use [configuration](reference/configuration.md) and [data models](reference/data-models.md) to understand what is stored and where.
