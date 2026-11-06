# Patterns and conventions

HomeStream uses strict TypeScript, ESM, shared Zod contracts, and explicit service construction. Follow the neighboring implementation rather than adding a second framework.

## Modules and types

`tsconfig.base.json` selects `NodeNext`, strict checking, unchecked-index checking, and explicit override checking. Server imports use `.js` specifiers in TypeScript source. `eslint.config.mjs` enforces type-only imports and permits unused arguments only with an underscore prefix.

Shared runtime schemas and inferred types belong in `packages/shared/src/`. Domain logic remains in server modules, and `apps/server/src/context.ts` describes the composed dependencies. See [shared contracts](../packages/shared.md).

## HTTP errors and validation

Use `AppError` and `invalidRequest` from `apps/server/src/errors.ts` for expected failures. `apps/server/src/app.ts` normalizes errors into an `error` envelope and hides unexpected server error details. Error text is redacted before returning it.

Keep route parsing in `apps/server/src/routes/` and service behavior in its domain directory. Preserve shared schema validation when extending request bodies.

## Resources and test seams

`apps/server/src/app.ts` accepts injectable services and narrowly scoped playback/proxy timing options. Its close hook distinguishes owned resources from supplied resources. Changes that create timers, subprocesses, sockets, or files need corresponding shutdown and test cleanup.

SQLite queries use prepared statements, and migrations execute transactionally (`apps/server/src/db/index.ts`). Do not alter previously applied SQL in place when introducing a schema change.

## Secrets

Register sensitive values through `apps/server/src/redact.ts`; `apps/server/src/logger.ts` applies field-level and full-line redaction. Do not log raw signed source URLs, tokens, request credentials, or user configuration contents.

See [testing](testing.md), [security](../security.md), and [development workflow](development-workflow.md).
