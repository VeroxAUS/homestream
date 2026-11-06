# AGENTS.md

Instructions for AI coding agents (and humans) working in HomeStream. Read this first. Human-oriented intro: [README.md](README.md). Rules for contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

HomeStream is a home media server. A Windows PC runs the server and does all video encoding (ffmpeg with NVENC). Clients (web UI, desktop shell, Google TV app) on the local network ask it for a title and play the HLS stream it produces. Movie data comes from TMDB, stream sources from an AIOStreams gateway, and cached downloads from TorBox.

## Project layout

| Path              | What it is                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/server`     | `@homestream/server`: Fastify 5 + TypeScript server on Node 24 (`node:sqlite`, ffmpeg, no native npm dependencies) |
| `apps/web`        | `@homestream/web`: React 19 + Vite web UI, served by the server at `/`                                             |
| `packages/shared` | `@homestream/shared`: zod schemas and types shared by every client and the server (the API contract)               |
| `scripts`         | Repository tooling (bootstrap, checks, reports). Plain Node `.mjs`, no build step                                  |
| `docs`            | Architecture, database, API export, privacy, runbooks. See [docs/architecture.md](docs/architecture.md)            |
| `docs/runbooks`   | Operational procedures: [docs/runbooks/README.md](docs/runbooks/README.md)                                         |
| `.factory/skills` | Repo-local agent skills (see [Skills and runbooks](#skills-and-runbooks))                                          |
| `.github`         | Workflows, templates and Dependabot config                                                                         |
| `.devcontainer`   | Dev container (Node 24, ffmpeg, pnpm)                                                                              |
| `droid-wiki`      | Generated wiki. Never edit by hand ([docs/wiki.md](docs/wiki.md))                                                  |

The Electron desktop shell and the Android TV app are planned as the apps named desktop and tv; the workspace already reserves the desktop folder.

Server source map (`apps/server/src`): `routes/` HTTP handlers (thin), `playback/` sessions, decision engine, ffmpeg arguments, HLS playlists, `sourceproxy/` loopback proxy and prefetch cache for upstream media, `gateway/` and `tmdb/` upstream clients, `streams/` parsing and ranking, `downloads/` TorBox caching queue, `db/` migrations and queries, `health/` checks, `events/` event log and SSE bus, `docs/` OpenAPI generation, `config.ts` settings, `redact.ts` secret scrubbing.

## Commands

Everything runs from the repository root. Node 24 and pnpm are required (`.nvmrc`).

```powershell
node scripts/bootstrap.mjs   # first time only (same as pnpm bootstrap): checks tools, installs, hooks, .env, builds shared
pnpm install                 # dependencies only
pnpm build                   # shared, server and web
pnpm typecheck
pnpm lint
pnpm format                  # write formatting
pnpm format:check
```

Tests come in four tiers (see [Testing](#testing)):

```powershell
pnpm test:unit               # fast, no network, no GPU, no keys
pnpm test:integration        # Fastify inject with stub gateway and fake encoders
pnpm test:ci                 # unit + integration (what CI runs)
pnpm test:coverage           # unit + integration with coverage thresholds
pnpm test:gpu                # real ffmpeg/NVENC encodes (GPU machine only)
pnpm test:live               # real TMDB/gateway calls (needs .env keys)
pnpm --filter @homestream/server exec vitest run --project unit test/net.test.ts   # one file
```

Quality gates (all must pass before a commit lands):

```powershell
pnpm knip                    # unused files, exports and dependencies
pnpm dup                     # duplicated code (jscpd)
pnpm deps:check              # module boundaries and cycles (dependency-cruiser)
pnpm syncpack:lint           # one version of each dependency across packages
pnpm techdebt                # TODO/FIXME/HACK budget
pnpm check:large-files       # no file over 1 MB
pnpm check:secrets           # secret scan of staged changes
pnpm coverage:ratchet        # print or raise coverage thresholds (they may only go up)
```

Generated documentation and doc checks:

```powershell
pnpm openapi:export          # docs/openapi.json from the running route table
pnpm openapi:check           # fails when docs/openapi.json is stale
pnpm db:schema               # docs/schema.sql from the migrations
pnpm db:schema:check         # fails when docs/schema.sql is stale or docs/database.md misses a table
pnpm docs:check              # relative links, anchors and mermaid diagrams in the markdown
pnpm agents:check            # this file, the skills and the runbooks only mention real commands, paths and endpoints
```

Run the server (port 8600) and the web dev server (port 8601, proxies `/api` and `/hls`):

```powershell
pnpm build
pnpm --filter @homestream/server start
pnpm --filter @homestream/web dev
```

API reference while the server runs: `http://localhost:8600/api/docs` (Swagger UI) and `/api/docs/json`.

## PowerShell 5.1 and POSIX notes

The primary development machine runs Windows PowerShell 5.1; CI and the dev container run Linux with bash. Commands in this file work in both unless noted.

- PowerShell 5.1 has no `&&` or `||`. Chain with `;` and check `$LASTEXITCODE`. In bash use `&&`.
- Set an environment variable for one command: PowerShell `$env:PORT = '0'; pnpm test:unit`, bash `PORT=0 pnpm test:unit`.
- Use `curl.exe` in PowerShell (`curl` is an alias for `Invoke-WebRequest`); `curl` elsewhere.
- Quote paths that contain spaces. Never write `package.json` or `pnpm-workspace.yaml` with `Set-Content -Encoding utf8` (it adds a BOM that breaks pnpm).
- pnpm prints progress to stderr, which PowerShell can report as an error even when the command succeeded. Judge success by the test summary and `$LASTEXITCODE` of the command itself.
- Long-running processes (server, dev server) must run in the background and be stopped by process id. Never stop processes by name.
- Use `pnpm exec`, never `npx`. Do not add a `packageManager` field to `package.json` (`devEngines` pins pnpm).

## Conventions

- **TypeScript strict** everywhere (`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`). TypeScript is pinned to 6.0.x for typescript-eslint.
- **Naming** is enforced by ESLint (`@typescript-eslint/naming-convention`): camelCase values and functions, PascalCase types and components, UPPER_CASE constants. Object keys that mirror wire formats, headers, env keys or DB columns are free.
- **Complexity**: functions stay under cyclomatic 20 and cognitive 20, nesting depth 4. Existing exceptions are listed in `eslint.config.mjs` and [docs/TECH_DEBT.md](docs/TECH_DEBT.md); never add new ones, split the function instead.
- **API contract**: request and response schemas are zod schemas in `packages/shared`. The server validates with them and clients import them. Field names are identical across TypeScript and Kotlin clients.
- **Errors** are always `{error:{code,message,hint?}}` with a plain-English `hint` for anything a user can act on. Throw `AppError` (see `apps/server/src/errors.ts`).
- **Redaction**: every log line, event and API error passes through `redact()`. Gateway URLs, CDN links and API keys must never reach a log, event, error, test fixture or commit.
- **Pure logic** (stream parsing, ranking, decision engine, ffmpeg arguments, playlists, progress rules, stats) lives in side-effect-free modules with unit tests.
- **Comments** only where the reason is not obvious from the code. Do not narrate what the code does.
- **Performance first**: nothing may make Home render, remote focus, playback start or HLS segment serving noticeably slower. Telemetry, metrics and logging are asynchronous, batched, sampled and never block startup or the playback path. Measure before and after when you touch a hot path.
- **Product decisions** (do not change without the owner): the PC does all encoding and video is always re-encoded; clients always send `streamId: "auto"` (there is no manual stream picker); there are no user accounts, devices are the only "who"; the server is for the local network only.
- **Dependencies**: add with `pnpm --filter <package> add <name>`; keep one version per dependency across packages (`pnpm syncpack:lint`); the server uses no native npm packages.
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org) (`feat(server): ...`, `fix:`, `docs:`, `chore:`, `test:`, `ci:`). One logical change per commit. **Every commit written by an AI agent ends with the trailer** `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>`. Never rewrite published history or force-push.
- Do not commit `.env`, keystores, `dist/`, `release/`, `node_modules/`, `reports/` or `coverage/`. Do not edit `droid-wiki/`.

## Testing

| Tier        | Command                 | Location                          | Needs                         | In CI |
| ----------- | ----------------------- | --------------------------------- | ----------------------------- | ----- |
| unit        | `pnpm test:unit`        | `apps/server/test/**` (not below) | nothing                       | yes   |
| integration | `pnpm test:integration` | `apps/server/test/integration/`   | nothing (stub gateway, fakes) | yes   |
| gpu         | `pnpm test:gpu`         | `apps/server/test/encode/`        | ffmpeg with NVENC, NVIDIA GPU | no    |
| live        | `pnpm test:live`        | `apps/server/test/live/`          | `.env` keys, network          | no    |

- Test files are named `*.test.ts` (`*.test.tsx` in the web app) and sit in `test/` (server, shared) or next to the source (web). Tests run in parallel, so they must not share state: use `PORT=0` (a random free port) and a unique temp directory from `makeTempDir()` in `apps/server/test/helpers.ts`, and clean up in `afterAll`. Never hard-code a port.
- HTTP routes are tested with Fastify `app.inject`. External services (gateway, TorBox, TMDB) are replaced with stubs in unit and integration tests. Real calls belong in `test/live/` only, and use few requests (the gateway allows about 5 requests per 5 seconds).
- Fixtures must never contain real secrets or real stream URLs. Use `example.test` hosts and invented tokens.
- GPU tests start real encoders. Run them alone, one file at a time, never while a game or other GPU-heavy program runs, and with every ffmpeg process stopped at the end. Stop sessions gently with `DELETE /api/sessions/:id` (no body, no content-type) before stopping the server.
- Limit download bandwidth in real-title tests: start the server with `MAX_DOWNLOAD_MBPS=60` or lower (the household shares the connection) and never download whole files for a test.
- Coverage thresholds live in `coverage-thresholds.json` of each package and may only be raised (`pnpm coverage:ratchet`).
- CI retries failing tests twice and writes JUnit and JSON reports to `reports/`; see [docs/runbooks/flaky-tests.md](docs/runbooks/flaky-tests.md).
- Port range for anything you start by hand: 8600-8699 (server 8600, web dev 8601). Do not use other ports.

## Telemetry rules

Telemetry is Sentry (errors) and PostHog (product analytics). The full description of what is sent is [docs/PRIVACY.md](docs/PRIVACY.md); keep it in sync with the code.

- Telemetry is **off** unless the matching key is set (`SENTRY_DSN_*`, `POSTHOG_API_KEY`), and `HOMESTREAM_TELEMETRY=off` disables all of it.
- Only the typed event catalog may be sent. Add an event to the catalog and to [docs/PRIVACY.md](docs/PRIVACY.md) in the same change.
- No gateway URL, stream URL, API key, IP address, file path or user text is ever sent. Everything passes through the scrubber (`redact()` plus an allow-list for analytics properties).
- Capture is manual only: no autocapture, no session recording, no user identification beyond a random install id.
- Telemetry code never throws into the caller, never blocks the request or playback path, and does nothing when its key is missing.
- Feature flags and experiments: [docs/experimentation.md](docs/experimentation.md).
- Follow the [homestream-telemetry skill](.factory/skills/homestream-telemetry/SKILL.md) when adding events.

## Secrets

- Secrets live in `.env` (ignored by git) or, for the packaged app, in `%APPDATA%\HomeStream\config.env`. [.env.example](.env.example) lists every key without values; keep it complete (a test fails when `KNOWN_KEYS` in `apps/server/src/config.ts` has a key that `.env.example` lacks).
- Never print, log, commit or paste secret values, in code, tests, fixtures, docs, issues or chat. The pre-commit hook and CI run gitleaks-style scans, but do not rely on them.
- Do not put personal identifiers (real LAN addresses, usernames, machine paths) in tracked files. Use RFC 5737 documentation addresses (`192.0.2.x`, `198.51.100.x`, `203.0.113.x`) and `example.test` hosts. Where a test needs a private-range address to exercise LAN ranking, use a generic one such as `192.168.1.50`.

## Adding things

- **New API route**: follow the [homestream-add-api-route skill](.factory/skills/homestream-add-api-route/SKILL.md): shared zod schema, thin route, entry in `apps/server/src/docs/routeDocs.ts`, tests, `pnpm openapi:export`.
- **New migration**: append to `apps/server/src/db/migrations.ts` (never edit an old one), `pnpm db:schema`, document the table in [docs/database.md](docs/database.md).
- **New setting**: add it to `KNOWN_KEYS` in `apps/server/src/config.ts` and to `.env.example`, and document the default.
- **New telemetry event**: see Telemetry rules.

## New app readiness checklist

Every new app (`apps/<name>`) must have all of this before its first feature lands, because the repository is scored per application:

- [ ] `lint`, `typecheck`, `test`, `test:ci` and `test:coverage` scripts, with coverage thresholds in `coverage-thresholds.json`
- [ ] A vitest config that uses the shared alias and the `*.test.ts` naming pattern, and at least one real test
- [ ] A `knip.jsonc` workspace entry, a dependency-cruiser rule, and prettier formatting
- [ ] Its own `README.md`
- [ ] Sentry init (DSN from env, scrubber, no-op without a DSN) and PostHog init (typed events, sanitizer)
- [ ] An `X-Request-ID` header on API calls and a structured logging wrapper
- [ ] A bundle budget (web apps) and an integration or end-to-end test directory
- [ ] Included in the Dependabot config and in the CI workflows
- [ ] The strict TypeScript config extending `tsconfig.base.json`

## Skills and runbooks

Repo-local skills (step-by-step procedures for agents) are in `.factory/skills/`:

- [homestream-run-checks](.factory/skills/homestream-run-checks/SKILL.md): run the right checks before committing
- [homestream-add-api-route](.factory/skills/homestream-add-api-route/SKILL.md): add or change an HTTP route
- [homestream-live-tests](.factory/skills/homestream-live-tests/SKILL.md): run the live and GPU tiers safely
- [homestream-telemetry](.factory/skills/homestream-telemetry/SKILL.md): add telemetry events without leaking data

Runbooks for operating the server are indexed in [docs/runbooks/README.md](docs/runbooks/README.md). Other documents: [docs/architecture.md](docs/architecture.md) (diagrams), [docs/database.md](docs/database.md), [docs/PRIVACY.md](docs/PRIVACY.md), [docs/TECH_DEBT.md](docs/TECH_DEBT.md), [docs/wiki.md](docs/wiki.md).

## CI checks

CI runs these on every push and pull request (the workflows are in `.github/workflows`). Run the same locally before you push:

1. `pnpm format:check`, `pnpm lint`, `pnpm typecheck`
2. `pnpm knip`, `pnpm dup`, `pnpm deps:check`, `pnpm syncpack:lint`, `pnpm techdebt`, `pnpm check:large-files`
3. `pnpm test:ci` and `pnpm test:coverage`
4. `pnpm agents:check` and `pnpm docs:check`
5. `pnpm openapi:check` and `pnpm db:schema:check` (generated docs must be committed)

GPU and live tests never run in CI. Pre-commit hooks (lefthook, installed by `pnpm install`) run prettier, ESLint, the secret scan and the large-file check on staged files, `pnpm agents:check` when this file changes, and `pnpm docs:check` when markdown changes.
