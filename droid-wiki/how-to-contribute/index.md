# Contributing

Work starts from `main` and ends with a focused pull request, tests, current generated contracts, and an honest account of checks run. `CONTRIBUTING.md` is the human guide; `AGENTS.md` adds the agent rules and product constraints.

## Pick up a change

Open an issue before work larger than a small fix. Use `.github/ISSUE_TEMPLATE/bug.yml` for reproducible failures and `.github/ISSUE_TEMPLATE/feature.yml` for proposals; security reports go privately through the Security tab as described in `SECURITY.md`. `.github/CODEOWNERS` assigns all paths to VeroxAUS.

Read [getting started](../overview/getting-started.md), then the relevant [feature](../features/index.md) or [system](../systems/index.md). The server is implemented; the [web app](../apps/web.md) is a placeholder, and desktop/TV clients are planned. Do not assume issue-template choices imply those clients exist.

| Change          | Start here                                                                        | Required companion work                                                  |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| HTTP behavior   | `apps/server/src/routes/` and `packages/shared/src/`                              | Shared schemas, thin handler, route docs, tests, regenerated OpenAPI     |
| Playback        | `apps/server/src/playback/`                                                       | Pure-rule coverage, lifecycle/fallback tests, measurements for hot paths |
| Upstream access | `apps/server/src/gateway/`, `apps/server/src/tmdb/`, `apps/server/src/downloads/` | Offline stubs; live verification only when needed                        |
| Database        | `apps/server/src/db/migrations.ts`                                                | Append migration, regenerate schema, document tables                     |
| Setting         | `apps/server/src/config.ts`                                                       | Update `KNOWN_KEYS`, `.env.example`, defaults and tests                  |
| Telemetry       | `packages/shared/src/analytics.ts`                                                | Typed event, allowlist, privacy docs, scrubber tests                     |

See [API](../api/index.md), [testing](testing.md), and [patterns and conventions](patterns-and-conventions.md) for the details behind these boundaries.

## Definition of done

- New behavior has tests; a bug fix has a regression test that would fail before the fix.
- One logical change per commit and pull request. Use Conventional Commits and the required AI trailer from `CONTRIBUTING.md`.
- Shared field names, actionable error hints, resource cleanup, and privacy rules remain intact.
- Maintained docs and generated `docs/openapi.json` / `docs/schema.sql` match changed behavior.
- Required checks pass, with GPU/live checks and any environment limitations stated explicitly.
- `.github/pull_request_template.md` is filled in: summary, checks, telemetry/privacy, secret review, and reviewer notes.

`AGENTS.md` records `Linux` and `Windows` as required checks on `main`; `.github/workflows/ci.yml` defines those exact job names. Lefthook's staged checks are a safety net, not the complete test/coverage gate. Never force-push or rewrite published history.

## Non-negotiable boundaries

The PC always re-encodes video, clients request `streamId: "auto"`, devices are not accounts, and the server is LAN-only (`AGENTS.md`). Changes must not slow Home rendering, focus, playback start, or HLS serving; attach before/after numbers for hot paths.

Do not put keys, signed URLs, personal addresses, local databases, or profiles into a patch or issue. Use invented fixtures and `example.test` hosts. Generated wiki pages are refreshed by automation, not edited as maintained documentation (`docs/wiki.md`).

## Key source files

| File                                             | Purpose                                           |
| ------------------------------------------------ | ------------------------------------------------- |
| `CONTRIBUTING.md`                                | Issue, branch, test, PR, license and commit rules |
| `AGENTS.md`                                      | Product decisions and complete quality gates      |
| `.github/CODEOWNERS`                             | Official ownership                                |
| `.github/pull_request_template.md`               | Review and privacy checklist                      |
| `.factory/skills/homestream-run-checks/SKILL.md` | Scope-based verification                          |
| `.github/workflows/ci.yml`                       | Cross-platform required jobs                      |

Continue with [development workflow](development-workflow.md), [tooling](tooling.md), or [debugging](debugging.md).
