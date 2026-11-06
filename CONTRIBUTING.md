# Contributing to HomeStream

Thanks for helping. This page is the short version of how to get a change merged. AI coding agents should also read [AGENTS.md](AGENTS.md).

## Set up

You need Node.js 24, pnpm 12, git and ffmpeg (NVENC only for playback). Then:

```powershell
node scripts/bootstrap.mjs
```

That single command installs dependencies, installs the git hooks, creates `.env` from [.env.example](.env.example) if you do not have one, and builds the shared package. A dev container is also available in [.devcontainer](.devcontainer/devcontainer.json). Details are in the [README](README.md).

## Make a change

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Create a branch from `main`. Keep the change focused: one logical change per commit and per pull request.
3. Write the test first when you can. New behaviour needs a test; a bug fix needs a test that failed before the fix.
4. Run the checks from the [homestream-run-checks skill](.factory/skills/homestream-run-checks/SKILL.md) (the list is also in [AGENTS.md](AGENTS.md#ci-checks)):

   ```powershell
   pnpm format:check
   pnpm lint
   pnpm typecheck
   pnpm knip
   pnpm test:ci
   ```

5. Update the docs that your change touches: [docs/architecture.md](docs/architecture.md), [docs/database.md](docs/database.md), a [runbook](docs/runbooks/README.md), [docs/PRIVACY.md](docs/PRIVACY.md) for telemetry. Regenerate `docs/openapi.json` and `docs/schema.sql` with `pnpm openapi:export` and `pnpm db:schema`.
6. Open a pull request against `main` and fill in the template.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org):

```text
feat(server): cache TorBox lookups for ten minutes
fix(web): keep focus on the play button after a seek
docs: add a runbook for a full transcode drive
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `revert`. Add a scope (`server`, `web`, `shared`, `desktop`, `tv`) when it helps. Write the subject in the imperative, no full stop, under about 72 characters. Explain why in the body.

**Commits written with an AI coding agent must end with this trailer**, separated from the body by a blank line:

```text
Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
```

Never rewrite published history and never force-push `main`.

## Test tiers

| Tier        | Command                 | Runs in CI | Needs                                 |
| ----------- | ----------------------- | ---------- | ------------------------------------- |
| unit        | `pnpm test:unit`        | yes        | nothing                               |
| integration | `pnpm test:integration` | yes        | nothing (stub gateway, fake encoders) |
| gpu         | `pnpm test:gpu`         | no         | NVIDIA GPU and ffmpeg with NVENC      |
| live        | `pnpm test:live`        | no         | `.env` keys and network               |

Tests must not share ports, directories or environment: use port 0 and a unique temp directory. External services are stubbed outside the live tier. Coverage thresholds (`coverage-thresholds.json`) only go up.

## Code standards

- TypeScript strict, formatted with prettier, linted with ESLint (complexity and naming rules are enforced). Do not leave unfinished-work markers in code; open an issue.
- Keep the API contract in `packages/shared`; the server and every client import it.
- Errors use `{error:{code,message,hint?}}` with a plain-English hint.
- Never commit secrets, real stream or gateway URLs, personal addresses or machine-specific paths. Use `example.test` hosts and RFC 5737 addresses in tests and docs. The pre-commit hook scans for secrets, but do not rely on it.
- Telemetry is opt-in and privacy-first. Read the rules in [AGENTS.md](AGENTS.md#telemetry-rules) before adding an event.
- Do not make Home render, focus, playback start or segment serving slower.

## Security and conduct

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing you agree that your contribution is licensed under the [GPL-3.0](LICENSE), the same license as the project.
