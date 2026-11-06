---
name: homestream-add-api-route
description: Add or change an HTTP route on the HomeStream server (shared zod schema, thin handler, OpenAPI entry, tests, regenerated docs/openapi.json). Use for any new or changed /api or /hls endpoint.
---

# Add an API route

The API contract is a set of zod schemas in `packages/shared`. The server validates with them, clients import them, and the OpenAPI document is generated from them. A route is done only when all steps below pass.

## 1. Define the contract

1. Add the request and response schemas to `packages/shared/src/` (`packages/shared/src/index.ts` re-exports each file). Field names are identical in TypeScript and Kotlin clients, so choose them carefully and never rename one later without a migration plan.
2. Use `z.infer` types in the handler. Do not hand-write a second type.

## 2. Write the route

1. Create or extend a file in `apps/server/src/routes/` and register it where the other routes are registered in `apps/server/src/app.ts`.
2. Keep the handler thin: parse input with `Schema.safeParse`, throw `invalidRequest(parsed.error)` on failure, call a service, return the result. Logic belongs in a testable module.
3. Errors are always `{error:{code,message,hint?}}`. Throw `AppError` (`apps/server/src/errors.ts`) with a plain-English `hint` for anything a user can act on.
4. Nothing on the playback or segment path may become slower. Do not add synchronous work or network calls to hot handlers.
5. Anything logged or returned passes through `redact()`. Never echo a gateway URL, stream URL or key.

## 3. Document it (documentation only)

Add an entry for the route to `ROUTE_DOCS` in `apps/server/src/docs/routeDocs.ts`, keyed by `METHOD /fastify/url` (for example `GET /api/downloads`). Build it with the `doc(...)` helper next to the other entries: a `summary`, a `tag`, optional `params` descriptions, a `query` or `body` zod schema, the `errors` status codes the route can return, and the success response (`ok(Schema)`), all taken from the shared zod schemas. These schemas only feed `/api/docs`; runtime validation stays in the handler. The OpenAPI integration test fails when a registered `/api` or `/hls` route has no entry.

## 4. Test it

1. Add tests in `apps/server/test/` (unit) or `apps/server/test/integration/` (HTTP with `app.inject`). Cover the success case, an invalid request (400 with the error shape), and the not-found case.
2. Use a unique temp directory (`makeTempDir()` from `apps/server/test/helpers.ts`) and `PORT=0`. Replace external services with stubs.
3. Run `pnpm test:ci`.

## 5. Regenerate and check

```powershell
pnpm openapi:export
pnpm openapi:check
pnpm agents:check
pnpm lint
pnpm typecheck
pnpm test:coverage
```

Commit `docs/openapi.json` together with the route. View the result at `http://localhost:8600/api/docs` while the server runs. If the route changes the architecture or the data model, update [docs/architecture.md](../../../docs/architecture.md) and [docs/database.md](../../../docs/database.md) too, and mention the endpoint in the matching runbook if operators will use it.
