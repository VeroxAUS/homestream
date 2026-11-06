# Tooling

pnpm workspaces and Turbo coordinate TypeScript builds and offline checks. Root configuration adds formatting, complexity, dependency, privacy and generated-document gates rather than leaving quality checks to editor defaults (`package.json`).

## Setup and task graph

`package.json` requires Node `>=24 <25` and pnpm `^12.16.0` through `devEngines`; `.nvmrc` supplies the Node major. Do not add a `packageManager` field. `pnpm-workspace.yaml` lists four actual packages: server, web, desktop and shared. Desktop is a support-module skeleton, not a working shell; no TV workspace exists.

`scripts/bootstrap.mjs` is a built-ins-only setup entry point. It checks tools, installs frozen dependencies/hooks, copies `.env.example` only when `.env` is absent and builds shared contracts. Root `prepare` runs `scripts/install-hooks.mjs`, skipping hooks in CI and trees without `.git`.

`turbo.json` gives `build` a dependency on upstream `^build` and caches `dist/**`. Shared compiler/lint/test config and the lockfile invalidate tasks. `test` is uncached; `test:ci` is a distinct task. Root coverage deliberately bypasses parallel Turbo execution and runs workspaces one at a time.

The distinction matters: `test:ci` remains cacheable with `outputs: []`, so a cache hit is not a fresh test run and does not restore report files. Use direct workspace test commands or sequential `pnpm test:coverage` when fresh execution/reports matter. CI caches `.turbo` by OS, lockfile and commit with fallback keys (`.github/workflows/ci.yml`).

There are no `env`, `globalEnv` or pass-through declarations in `turbo.json`, and repository `.env` is not listed as a global dependency. Turbo's default strict environment filtering is therefore not a general pass-through for arbitrary HomeStream variables; build-time telemetry environment and changes to ignored `.env` should not be assumed to invalidate a cached build. For deliberate environment-specific UI builds, invoke `pnpm --filter @homestream/web build` directly, as the CI bundle and e2e jobs do, and verify the selected inputs. `apps/web/vite.config.ts` loads repository env files and gives process environment precedence. Never print their values while diagnosing a cache miss/hit.

| Command               | Implementation                             | Use                               |
| --------------------- | ------------------------------------------ | --------------------------------- |
| `pnpm build`          | `turbo.json`, workspace build scripts      | Shared output before dependents   |
| `pnpm build:summary`  | Turbo `--summarize`                        | Per-package build timing          |
| `pnpm typecheck`      | `tsconfig.base.json` and workspace configs | Strict no-emit checks             |
| Server development    | `apps/server/package.json`                 | tsx watch                         |
| Web development/build | `apps/web/vite.config.ts`                  | React/Vite, API/HLS proxy         |
| Server build          | `apps/server/tsconfig.build.json`          | ESM JavaScript and source maps    |
| Shared build          | `packages/shared/tsconfig.build.json`      | JavaScript, declarations and maps |

Strict TypeScript uses NodeNext and unchecked-index checks. Web overrides module resolution for bundling. Prefer `pnpm exec`, never `npx` (`AGENTS.md`).

## Static gates

| Command                  | Configuration/source                               | Enforced boundary                                           |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm format:check`      | `.prettierrc`, `.prettierignore`                   | Prettier formatting; generated outputs/wiki excluded        |
| `pnpm lint`              | `eslint.config.mjs`                                | Workspace lint plus root scripts/config lint                |
| `pnpm knip`              | `knip.jsonc`                                       | Unused files, exports and dependencies                      |
| `pnpm dup`               | `.jscpd.json`                                      | At most 0.5% duplication in scanned production/tooling code |
| `pnpm deps:check`        | `.dependency-cruiser.cjs`                          | No cycles, unresolved imports or cross-layer leaks          |
| `pnpm syncpack:lint`     | `.syncpackrc.json`                                 | Consistent dependency ranges                                |
| `pnpm techdebt`          | `scripts/techdebt.mjs`, `techdebt.config.json`     | Zero TODO/FIXME/HACK marker budget                          |
| `pnpm check:large-files` | `scripts/check-large-files.mjs`                    | 1 MiB limit; lockfile allowlisted                           |
| `pnpm check:secrets`     | `scripts/pre-commit-secrets.mjs`, `.gitleaks.toml` | Staged secret/path scan                                     |

`eslint.config.mjs` enforces naming, type-only imports, cyclomatic/cognitive ceilings of 20 and nesting depth 4. Legacy per-file exceptions have measured ceilings; new code must be split instead of adding exceptions. See [cleanup opportunities](../cleanup-opportunities.md).

Dependency-cruiser prevents shared importing apps, web/desktop importing server or each other, server importing web/desktop, production source importing test helpers, unresolved imports and cycles. Knip ignores script declaration files resolved by TypeScript and the unused Electron runtime dependency until a shell start path exists (`knip.jsonc`). There is no longer a web/shared ignore-dependency exception: `docs/TECH_DEBT.md` is stale on that point and on its placeholder-web-test description. See the current [testing](testing.md) and [web screens](../apps/web/screens.md).

jscpd scans apps/packages/scripts, excluding tests, declarations, generated outputs and TV. `lefthook.yml` checks staged formatting/lint/secrets/size and relevant Markdown/agent validation; it never runs tests.

## Generated documentation and instruction checks

| Command                                      | Source of truth                                                      | Output/check                                                      |
| -------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm openapi:export` / `pnpm openapi:check` | Registered routes + shared Zod + `apps/server/src/docs/routeDocs.ts` | `docs/openapi.json`                                               |
| `pnpm db:schema` / `pnpm db:schema:check`    | `apps/server/src/db/migrations.ts`                                   | `docs/schema.sql`, table sections in `docs/database.md`           |
| `pnpm docs:check`                            | `scripts/check-docs.mjs`                                             | Relative links/anchors; maintained architecture diagram checks    |
| `pnpm agents:check`                          | `scripts/validate-agents-md.mjs`                                     | Real commands, paths, endpoints and required instruction sections |

`apps/server/src/docs/export.ts` constructs an in-memory app with temporary data and no configuration/network dependence. `apps/server/src/docs/generated.ts` renders deterministic OpenAPI/schema files; do not hand-edit the exports.

`docs:check` excludes `droid-wiki/` and its diagram checks are structural, not full Mermaid rendering. Wiki generation therefore also needs its own page-tree, link and source-path audit. `.github/workflows/docs.yml` regenerates the maintained exports and fails if they differ from committed files.

## Reports and automation

[Testing](testing.md) covers `test:ci`, sequential coverage, retry reports and threshold ratcheting. Repository automation is explicit about side effects:

| Command/workflow                       | Behavior                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm readiness:audit`                 | `scripts/readiness-audit.mjs` evaluates `scripts/readiness-criteria.json`; supports `--all`, `--apps`, `--strict`, `--json`; some checks inspect GitHub state |
| `pnpm release:next`                    | `scripts/next-version.mjs` dry-runs the Conventional Commit release plan                                                                                      |
| `pnpm labels:sync`                     | `scripts/sync-labels.mjs` creates/updates GitHub labels from `.github/labels.yml`; add `--dry-run` to inspect first                                           |
| `pnpm flags:check` / `pnpm flags:sync` | `scripts/flags.mjs` validates registry usage or creates missing PostHog flags; sync needs a personal key and supports dry run                                 |
| `pnpm sentry:issues`                   | `scripts/sentry-issues.mjs` dry-run; scheduled workflow performs issue creation                                                                               |
| `pnpm sentry:alerts --dry-run`         | `scripts/sentry-alerts.mjs` plans rules from `monitoring/sentry/alert-rules.json`; `--apply` writes remotely                                                  |
| `pnpm telemetry:smoke`                 | Server smoke CLI deliberately sends configured test telemetry                                                                                                 |
| `pnpm profile:server`                  | `scripts/profile-server.mjs` profiles a throwaway server                                                                                                      |

Do not run sync/apply/smoke commands as routine offline validation.

`.github/workflows/ci.yml` implements Linux + Windows checks. CodeQL, full-history Gitleaks and Dependabot have their own workflows/configuration. `.github/workflows/devcontainer.yml` builds the development image and runs unit tests. `.github/workflows/droid-wiki-refresh.yml` runs daily or manually, restores the rolling wiki branch, separates read-only generation from write-enabled publishing, and excludes images/video from git.

## Generated wiki lifecycle

`docs/wiki.md` describes wiki refresh rather than a hand-maintained documentation workflow. `.github/workflows/droid-wiki-refresh.yml` checks daily at 17:00 UTC or on manual dispatch; it skips unchanged main code unless forced. Generation restores the previous wiki and uploads an artifact; publishing opens or updates the rolling `factory/droid-wiki` pull request.

`scripts/wiki-mirror.mjs` makes the destination match that artifact, rather than overlaying files. Dropped pages are therefore deleted. It refuses an artifact missing `.wiki-meta.json` and preserves destination `images/` and `video/` folders; those assets are not copied from the artifact or committed. Run this tool only in the publishing workflow or another explicitly reviewed regeneration, not as a local cleanup command.

Ordinary CI ignores wiki-only changes. The wiki publisher posts success statuses with the recorded required names `Linux` and `Windows` so its generated-only PR can merge; renaming required checks needs a matching workflow update (`.github/workflows/droid-wiki-refresh.yml`). Maintained-doc checks and Prettier ignore this tree, so generation requires its own relative-link, source-path, title, size and page-tree validation. Fix source or maintained docs for lasting corrections; a subsequent regeneration overwrites wiki edits.

## Key source files

| File                                             | Purpose                                 |
| ------------------------------------------------ | --------------------------------------- |
| `package.json`                                   | Root command catalog and tool versions  |
| `turbo.json`                                     | Task dependencies and caching           |
| `eslint.config.mjs`                              | Naming, complexity and legacy ceilings  |
| `.dependency-cruiser.cjs`                        | Module boundaries                       |
| `vitest.shared.ts`                               | Common workers, timeouts and CI reports |
| `.factory/skills/homestream-run-checks/SKILL.md` | Scope-based gates                       |
| `.github/workflows/droid-wiki-refresh.yml`       | Scheduled generated wiki lifecycle      |

See [development workflow](development-workflow.md), [deployment](../deployment.md), and [dependencies](../reference/dependencies.md).
