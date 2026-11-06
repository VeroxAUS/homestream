# Patterns and conventions

HomeStream uses strict TypeScript, shared Zod contracts, thin routes, and explicit service construction. Follow `AGENTS.md`, `CONTRIBUTING.md`, and nearby code when changing behavior.

## Types and modules

`tsconfig.base.json` enables strict mode, unchecked-index checks, explicit overrides, and switch fallthrough checks. Server imports use `.js` specifiers; web build configuration uses bundler resolution (`apps/server/tsconfig.json`, `apps/web/tsconfig.json`). `eslint.config.mjs` enforces type-only imports, camelCase values, PascalCase types, complexity ceilings of 20, and nesting depth 4. Existing exceptions are debt, not permission to add new ones (`docs/TECH_DEBT.md`).

Runtime contracts and inferred types live in `packages/shared/src/`. Keep wire field names identical across clients. Parsing, ranking, encoder decisions, playlists, and statistics rules should remain pure and unit-tested (`AGENTS.md`). Apps may import shared contracts but never each other (`.dependency-cruiser.cjs`).

## HTTP and errors

Server handlers in `apps/server/src/routes/` validate shared schemas and delegate to services. Expected failures use `AppError` from `apps/server/src/errors.ts`. Errors have `{error:{code,message,hint?}}`, with a plain-English hint when the user can act. The app hides unexpected failure details (`apps/server/src/app.ts`).

Browser requests use `apiFetch` or schema-validating `apiGet`, which attach `X-Request-ID` and throw `ApiError` (`apps/web/src/api/client.ts`). Do not add direct `/api` fetches. Desktop requests use `withRequestId` from `apps/desktop/src/requestId.ts`.

Route changes require contracts, OpenAPI entries, tests, and a regenerated export. Follow `.factory/skills/homestream-add-api-route/SKILL.md`; see [API](../api/index.md).

## Resource ownership

`apps/server/src/app.ts` provides test seams for network, clocks, encoders, and limits. Its close hook stops workers before closing resources and preserves injected dependencies it does not own. Timers, subprocesses, sockets, and temporary directories need explicit cleanup.

Append migrations to `apps/server/src/db/migrations.ts`, never rewrite applied ones. Regenerate `docs/schema.sql` and update `docs/database.md` (`apps/server/src/db/index.ts`). Tests use isolated directories and port 0, with no real upstream calls outside the live tier (`AGENTS.md`).

## Privacy and performance

Never log raw gateway/CDN URLs, credentials, or user text. Server redaction is in `apps/server/src/redact.ts`; browser and desktop logs use their own wrappers (`apps/web/src/logger.ts`, `apps/desktop/src/logger.ts`). Analytics events and property allowlists live in `packages/shared/src/analytics.ts`; new events require a matching `docs/PRIVACY.md` update.

Browser telemetry keys are baked in at build time. SDK imports stay outside the initial bundle. Device registration, SSE, and telemetry wait until content is visible and the browser is idle (`apps/web/src/telemetry/index.ts`, `apps/web/src/lib/startup.ts`, `apps/web/src/main.tsx`). Preserve the bundle budgets in `apps/web/.size-limit.json`.

Do not change the product rules: video is re-encoded, clients send `streamId: "auto"`, devices are not accounts, and the listener is LAN-only. Measure hot paths before and after changes (`AGENTS.md`). See [testing](testing.md), [security](../security.md), and [development workflow](development-workflow.md).
