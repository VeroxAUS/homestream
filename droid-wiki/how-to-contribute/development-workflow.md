# Development workflow

Use Node 24 and pnpm 12 from the repository root. Bootstrap once, branch from `main`, update code and its contracts together, then run the gates appropriate to the change (`CONTRIBUTING.md`, `package.json`).

## Prepare the workspace

```powershell
node scripts/bootstrap.mjs
```

`scripts/bootstrap.mjs` checks Node/pnpm, warns about missing FFmpeg/NVENC, installs with the frozen lockfile, installs hooks outside CI, preserves an existing `.env`, and builds shared contracts. `.devcontainer/devcontainer.json` runs the same bootstrap and configures a temporary test root.

Create a focused branch from `main`; there is no required branch-name pattern in `CONTRIBUTING.md`. Discuss larger changes in an issue first. Use [configuration](../reference/configuration.md) for private local settings and writable paths.

Run the server and Vite in separate terminals:

```powershell
pnpm --filter @homestream/server dev
pnpm --filter @homestream/web dev
```

The server uses tsx watch (`apps/server/package.json`); Vite listens on 8601 and proxies `/api` and `/hls` to 8600 (`apps/web/vite.config.ts`). Its target is fixed, not derived from the server's `PORT`. Runtime imports use the built shared package, so rebuild it after contract changes; tests alias shared source directly.

## Implement at the right layer

Keep handlers in `apps/server/src/routes/` thin. Change shared Zod schemas before wiring new HTTP behavior; register documentation in `apps/server/src/docs/routeDocs.ts`, test with injection/stubs, and run `pnpm openapi:export`. Follow `.factory/skills/homestream-add-api-route/SKILL.md`.

Append database migrations in `apps/server/src/db/migrations.ts`, then run `pnpm db:schema` and update `docs/database.md`. For telemetry, follow `.factory/skills/homestream-telemetry/SKILL.md` and update `docs/PRIVACY.md` in the same change. Timers, subprocesses, sockets and temporary files need an explicit cleanup owner in the [server](../apps/server.md).

## Verify before review

The complete code-change gate from `AGENTS.md` and `.factory/skills/homestream-run-checks/SKILL.md` is:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm knip
pnpm dup
pnpm deps:check
pnpm syncpack:lint
pnpm techdebt
pnpm check:large-files
pnpm test:ci
pnpm test:coverage
pnpm flags:check
pnpm openapi:check
pnpm db:schema:check
pnpm docs:check
pnpm agents:check
```

Markdown-only changes need format, docs and agent validators; route/schema/migration changes also need generated-document checks. Fix failures rather than widening budgets or complexity limits. [Tooling](tooling.md) explains each gate. Run GPU/live only when the change needs them; `pnpm test` is not the safe offline default ([testing](testing.md)).

Lefthook checks staged formatting, ESLint, secrets and file sizes, plus documentation links for Markdown and agent instructions when `AGENTS.md` changes (`lefthook.yml`). It does not run the test suite. Review the staged diff and run `pnpm check:secrets`; exclude `.env`, build outputs, reports and coverage.

## Commit, PR and CI

Use an imperative Conventional Commit subject, usually under 72 characters, with an optional scope. Every AI-written commit ends with:

```text
Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
```

Open the PR against `main` using `.github/pull_request_template.md`. Include the exact checks run, relevant hardware/live checks not run, privacy changes and hot-path measurements. Do not rewrite published history or force-push.

`.github/workflows/ci.yml` runs full Linux static/documentation/security gates and offline coverage; Windows runs typechecking and selected path/process-sensitive unit files. `Linux` and `Windows` are the required status names recorded in `AGENTS.md`. GPU and live tiers never run in CI. Generated-wiki-only changes are excluded and handled by their own workflow; see [deployment](../deployment.md).

## Key source files

| File                               | Purpose                                     |
| ---------------------------------- | ------------------------------------------- |
| `scripts/bootstrap.mjs`            | Repeatable first-time setup                 |
| `apps/server/package.json`         | Server development, build and tier commands |
| `apps/web/vite.config.ts`          | Dev port and API/HLS proxy                  |
| `lefthook.yml`                     | Staged checks                               |
| `.github/pull_request_template.md` | PR handoff contract                         |
| `.github/workflows/ci.yml`         | Linux and Windows validation                |
| `.github/workflows/docs.yml`       | Regeneration drift checks                   |

PowerShell 5.1 lacks `&&`: run commands separately, or use `;` and check `$LASTEXITCODE`. Use `curl.exe` rather than its PowerShell alias, and judge pnpm by exit status rather than stderr progress (`AGENTS.md`).
