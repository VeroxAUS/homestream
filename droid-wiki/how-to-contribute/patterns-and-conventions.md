# Patterns and conventions

HomeStream uses strict TypeScript, shared Zod contracts, thin routes, and explicit service construction. Follow `AGENTS.md`, `CONTRIBUTING.md`, and nearby code when changing behavior.

## Types and modules

`tsconfig.base.json` enables strict mode and unchecked-index checks. Server imports use `.js` specifiers; the browser uses bundler resolution (`apps/server/tsconfig.json`, `apps/web/tsconfig.json`). Type-only imports, camelCase values, PascalCase types, complexity ceilings of 20, and nesting depth 4 are enforced by `eslint.config.mjs`.

New source files stay within 400 counted lines and functions within 80; tests are exempt from the function limit. Grandfathered ceilings in `code-limits.baseline.json` may only shrink. Do not add exceptions to work around a failing check (`scripts/code-limits.mjs`, `AGENTS.md`).

Runtime contracts live under `packages/shared/src`; keep wire names consistent across clients. Pure parsing, ranking, decisions, playlists, and statistics rules get offline unit tests. Apps cannot import each other; desktop IPC contracts belong in shared code (`.dependency-cruiser.cjs`, `packages/shared/src/desktop.ts`).

Use schema defaults for additive response fields when newer clients must read older server responses. Cast and similar-title arrays default to empty lists in `packages/shared/src/catalog.ts`; the current server still returns both fields. Local UI choices stay local: the spoiler preference uses `useSyncExternalStore`, storage events, and an in-memory fallback when browser storage is blocked (`apps/web/src/lib/spoilers.ts`).

## HTTP and errors

Handlers under `apps/server/src/routes` validate shared schemas and call services. Expected failures use `AppError`; errors have `{error:{code,message,hint?}}`, with an actionable plain-English hint. Unexpected failures are redacted by the app (`apps/server/src/errors.ts`, `apps/server/src/app.ts`).

Browser API calls use `apiFetch` or schema-validating `apiGet`, which attach `X-Request-ID` and throw `ApiError`. The UUID helper also works on plain-HTTP LAN origins without `crypto.randomUUID` (`apps/web/src/api/client.ts`, `apps/web/src/lib/uuid.ts`). Desktop calls attach request IDs through `apps/desktop/src/requestId.ts`.

Route changes require shared contracts, OpenAPI entries, tests, and regenerated exports. Follow `.factory/skills/homestream-add-api-route/SKILL.md`; see [API](../api/index.md).

## Resource ownership

Services accept test seams for network, clocks, encoders, and limits. The app closes resources it owns and stops workers before database shutdown (`apps/server/src/app.ts`). Timers, sockets, subprocesses, and temporary directories need explicit cleanup.

Playback serializes launches and retains slot ownership until old encoders really exit. Track changes and seeks must not spawn replacements over a still-running process (`apps/server/src/playback/sessionSlots.ts`, `apps/server/src/playback/encoderLifecycle.ts`, `apps/server/src/playback/recovery.ts`). Desktop restart operations also serialize; attached and owned servers have different shutdown obligations (`apps/desktop/src/supervisor.ts`).

Append database migrations, never rewrite applied ones. Regenerate `docs/schema.sql` and update `docs/database.md` (`apps/server/src/db/migrations.ts`, `apps/server/src/db/index.ts`). Tests use isolated temp directories and port 0; real upstream calls stay in the live tier (`AGENTS.md`).

## Privacy and performance

Never log raw gateway/CDN URLs, credentials, or user text. Use redaction and structured logger wrappers (`apps/server/src/redact.ts`, `apps/web/src/logger.ts`, `apps/desktop/src/logger.ts`). Analytics events and property allowlists live in `packages/shared/src/analytics.ts`; changing them requires updating `docs/PRIVACY.md`.

Browser telemetry keys are build-time values. SDK imports stay outside the initial bundle, and registration, SSE, and telemetry wait for rendered content and idle time (`apps/web/src/main.tsx`, `apps/web/src/lib/startup.ts`, `apps/web/src/telemetry/index.ts`). Preserve the limits in `apps/web/.size-limit.json`.

Declare every environment variable read by the web build in the root `turbo.json` build task. The web override in `apps/web/turbo.json` disables build caching: Vite also reads `.env`, and restoring cached output could leave files containing earlier keys beside a newer build. `apps/web/src/telemetry/buildEnv.ts` clears both keys and the PostHog host for test or telemetry-off builds; `apps/web/src/telemetry/turboEnv.test.ts` guards the declarations and no-cache policy.

Do not change product rules: video is always re-encoded, clients request `streamId: "auto"`, devices are not accounts, and deployment is LAN-only. Measure hot paths before and after changes (`AGENTS.md`). See [testing](testing.md), [security](../security.md), and [development workflow](development-workflow.md).
