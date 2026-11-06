# Patterns and conventions

HomeStream uses strict TypeScript, shared Zod contracts, thin routes, and explicit service construction. The durable project rules are in `AGENTS.md` and `CONTRIBUTING.md`; follow neighboring code rather than introducing another framework.

## Types and modules

`tsconfig.base.json` sets strict mode, `NodeNext`, unchecked-index checks, explicit override checks, and switch fallthrough checks. Server TypeScript imports use `.js` specifiers. `eslint.config.mjs` enforces type-only imports, camelCase values, PascalCase types, constant naming, cyclomatic and cognitive complexity limits of 20, and nesting depth 4. Existing exceptions are recorded, not permission to add new ones (`docs/TECH_DEBT.md`).

Shared runtime schemas and inferred types belong under `packages/shared/src/`. Keep API field names identical across clients. Pure parsing, ranking, decision, playlist, and statistics rules should remain side-effect-free and unit-tested (`AGENTS.md`).

## Routes and errors

Validate with shared schemas in `apps/server/src/routes/`, then delegate behavior to services. Use `AppError` or `invalidRequest` from `apps/server/src/errors.ts` for expected failures. Errors have `{error:{code,message,hint?}}`; actionable errors need a plain-English hint. `apps/server/src/app.ts` hides unexpected server error details, and `errorBody` redacts returned text.

Route changes require shared schemas, route documentation, tests, and a regenerated OpenAPI export. Follow `.factory/skills/homestream-add-api-route/SKILL.md`; see [API](../api/index.md).

## Resource ownership

`apps/server/src/app.ts` exposes narrow test seams for network clients, subprocesses, clocks, and limits. Its close hook stops services before releasing owned resources; injected resources remain the caller's responsibility. Timers, sockets, subprocesses, and temporary directories need explicit shutdown and test cleanup.

SQLite uses prepared statements and transactional numbered migrations (`apps/server/src/db/index.ts`). Append migrations to `apps/server/src/db/migrations.ts`, never rewrite an applied migration. Regenerate `docs/schema.sql` and update `docs/database.md` when the schema changes.

## Safety and performance

Never log raw gateway/CDN URLs or keys. Register secrets with `apps/server/src/redact.ts`; logs, events, API errors, and telemetry have separate scrubbing boundaries. Typed events and allowlisted properties live in `packages/shared/src/analytics.ts`. Telemetry must remain optional, non-blocking, and harmless when unavailable (`apps/server/src/telemetry/index.ts`).

Do not change the product decisions: the server re-encodes all video, clients request `streamId: "auto"`, devices replace accounts, and the service is LAN-only (`AGENTS.md`). Measure before and after changing playback startup, segment serving, or other hot paths.

Use isolated temporary directories and port 0 in tests. Real upstream calls belong only in the live tier; real encodes belong in the GPU tier (`AGENTS.md`). See [testing](testing.md), [security](../security.md), and [development workflow](development-workflow.md).
