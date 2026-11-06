---
name: homestream-run-checks
description: Run the right HomeStream checks before committing or pushing (format, lint, types, dead code, duplication, tests, generated docs). Use after any code or docs change and before every commit.
---

# Run the checks

Run everything from the repository root. Judge success by the exit code of each command (`$LASTEXITCODE` in PowerShell, `$?` in bash), not by stderr noise: pnpm prints progress to stderr. Run heavy commands one at a time and keep test workers modest on a shared machine.

## 1. Pick the scope

| You changed                                      | Run at least                                                |
| ------------------------------------------------ | ----------------------------------------------------------- |
| Markdown only                                    | `pnpm format:check`, `pnpm docs:check`, `pnpm agents:check` |
| TypeScript in `apps/server` or `packages/shared` | steps 2 to 4                                                |
| A route, a shared schema or a migration          | steps 2 to 5                                                |
| `scripts/`, `lefthook.yml`, root config          | steps 2 and 3, plus `pnpm deps:check`                       |

When unsure, run everything.

## 2. Format and static checks

```powershell
pnpm format            # writes fixes; then:
pnpm format:check
pnpm lint
pnpm typecheck
pnpm knip
pnpm dup
pnpm deps:check
pnpm syncpack:lint
pnpm techdebt
pnpm check:large-files
```

Fix the cause instead of silencing a rule. Complexity limits (cyclomatic 20, cognitive 20, depth 4) are not to be raised: split the function. Do not leave marker comments for future work; the tech-debt budget is zero, track debt in [docs/TECH_DEBT.md](../../../docs/TECH_DEBT.md).

## 3. Tests

```powershell
pnpm test:ci
pnpm test:coverage
```

`pnpm test:ci` runs the unit and integration tiers. `pnpm test:coverage` also checks the thresholds in `coverage-thresholds.json`, which may only go up (`pnpm coverage:ratchet` shows or raises them). For one file:

```powershell
pnpm --filter @homestream/server exec vitest run --project unit test/net.test.ts
```

Never run `pnpm test:gpu` or `pnpm test:live` as part of the normal checks. See the [homestream-live-tests skill](../homestream-live-tests/SKILL.md).

## 4. Generated files

```powershell
pnpm openapi:check
pnpm db:schema:check
pnpm docs:check
pnpm agents:check
```

If `openapi:check` or `db:schema:check` fails, run `pnpm openapi:export` or `pnpm db:schema`, review the diff and commit the result with the code that caused it.

## 5. Before you commit

- `git status` shows only files you meant to change. Never stage `.env`, `reports/`, `coverage/`, `dist/` or `droid-wiki/`.
- Look at `git diff --staged` for secrets: gateway URLs, stream URLs, API keys, tokens, personal LAN addresses. The pre-commit hook scans too, but it is a safety net.
- Commit with a Conventional Commit message. A commit written by an AI agent ends with the trailer `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>`.
- Then `git pull --rebase` and push. Never force-push.

The hooks (lefthook) run prettier, ESLint, the secret scan and the large-file check on staged files; they are installed by `pnpm install` or `node scripts/bootstrap.mjs`.
