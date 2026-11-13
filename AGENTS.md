# AGENTS.md

Instructions for AI coding agents (and humans) working in HomeStream. Read this first. Human-oriented intro: [README.md](README.md). Rules for contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

HomeStream is a home media server. A Windows PC runs the server and does all video encoding (ffmpeg with NVENC). Clients (web UI, desktop shell, Google TV app) on the local network ask it for a title and play the HLS stream it produces. Movie data comes from TMDB, stream sources from an AIOStreams gateway, and cached downloads from TorBox.

## Project layout

| Path              | What it is                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/server`     | `@homestream/server`: Fastify 5 + TypeScript server on Node 24 (`node:sqlite`, ffmpeg, no native npm dependencies) |
| `apps/web`        | `@homestream/web`: React 19 + Vite web UI, served by the server at `/`                                             |
| `apps/desktop`    | `@homestream/desktop`: Electron 45 desktop shell around the web UI (tray, server supervisor, mini player)          |
| `packages/shared` | `@homestream/shared`: zod schemas and types shared by every client and the server (the API contract)               |
| `scripts`         | Repository tooling (bootstrap, checks, reports). Plain Node `.mjs`, no build step                                  |
| `docs`            | Architecture, database, API export, privacy, runbooks. See [docs/architecture.md](docs/architecture.md)            |
| `docs/runbooks`   | Operational procedures: [docs/runbooks/README.md](docs/runbooks/README.md)                                         |
| `.factory/skills` | Repo-local agent skills (see [Skills and runbooks](#skills-and-runbooks))                                          |
| `.github`         | Workflows, templates and Dependabot config                                                                         |
| `.devcontainer`   | Dev container (Node 24, ffmpeg, pnpm)                                                                              |
| `droid-wiki`      | Generated wiki. Never edit by hand ([docs/wiki.md](docs/wiki.md))                                                  |

The Android TV app is planned as the app named tv. Conventions for the web UI and the desktop shell (telemetry, requests, logging, bundle budget, e2e) are in [apps/web/README.md](apps/web/README.md), [apps/desktop/README.md](apps/desktop/README.md) and [Web and desktop apps](#web-and-desktop-apps).

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
pnpm --filter @homestream/web size       # web bundle budget (size-limit, run build first); same for @homestream/desktop
pnpm --filter @homestream/web analyze    # bundle treemap in apps/web/reports/bundle.html
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

Repository automation:

```powershell
pnpm readiness:audit          # self-audit against the Factory readiness criteria (add --all, --apps a,b, --strict, --json)
pnpm release:next             # next version from the Conventional Commits since the last tag (dry run)
pnpm labels:sync             # make the GitHub labels match .github/labels.yml (needs gh)
pnpm ci:summary              # coverage, flaky and slowest tests as Markdown (what CI puts in the job summary)
pnpm sentry:issues           # dry run of the Sentry-to-GitHub issue sync (needs SENTRY_API_TOKEN, SENTRY_ORG, GITHUB_TOKEN)
```

Telemetry, flags and profiling (details in [docs/observability.md](docs/observability.md)):

```powershell
pnpm flags:check            # fails for dead flags and for flags the code evaluates but the registry lacks
pnpm flags:sync             # creates missing flags in PostHog (needs POSTHOG_PERSONAL_API_KEY, otherwise skips)
pnpm telemetry:smoke --sentry   # sends one deliberate test error; add --posthog or use neither flag for both
pnpm sentry:alerts --dry-run    # prints the rules of monitoring/sentry/alert-rules.json, offline; --apply makes Sentry match it
pnpm profile:server         # CPU profile of a throw-away server into reports/profiles
```

Run the server (port 8600) and the web dev server (port 8601, proxies `/api` and `/hls`):

```powershell
pnpm build
pnpm --filter @homestream/server start
pnpm --filter @homestream/web dev
```

API reference while the server runs: `http://localhost:8600/api/docs` (Swagger UI) and `/api/docs/json`. Operations endpoints (no external calls, not logged per scrape): `/healthz` (liveness), `/readyz` (database and data directory usable, else 503) and `/metrics` (Prometheus text). Every response carries `X-Request-ID`, which is the `reqId` field in `server.log`. See [docs/observability.md](docs/observability.md).

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
- **Complexity**: functions stay under cyclomatic 20 and cognitive 20, nesting depth 4. Existing exceptions are listed in `eslint.config.mjs` and [docs/TECH_DEBT.md](docs/TECH_DEBT.md); never add new ones, split the function instead. **Size**: files stay at 400 lines and functions at 80 (blank lines and comments not counted; tests are exempt from the function limit). Files that predate the limits have ceilings in `code-limits.baseline.json`; `pnpm lint` fails when a ceiling is above the real size or an entry is added or raised compared with the previous main commit. Never add or raise an entry, split the file instead; lower ceilings with `node scripts/code-limits.mjs --write`.
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

| Tier        | Command                                  | Location                          | Needs                                           | In CI                 |
| ----------- | ---------------------------------------- | --------------------------------- | ----------------------------------------------- | --------------------- |
| unit        | `pnpm test:unit`                         | `apps/server/test/**` (not below) | nothing                                         | yes                   |
| integration | `pnpm test:integration`                  | `apps/server/test/integration/`   | nothing (stub gateway, fakes)                   | yes                   |
| gpu         | `pnpm test:gpu`                          | `apps/server/test/encode/`        | ffmpeg with NVENC, NVIDIA GPU                   | no                    |
| live        | `pnpm test:live`                         | `apps/server/test/live/`          | `.env` keys, network                            | no                    |
| web         | `pnpm --filter @homestream/web test`     | `apps/web/src/**/*.test.ts(x)`    | nothing (jsdom, Testing Library)                | yes (`test:coverage`) |
| desktop     | `pnpm --filter @homestream/desktop test` | `apps/desktop/test/**`            | nothing (Electron is not started)               | yes (`test:coverage`) |
| e2e         | `pnpm --filter @homestream/web test:e2e` | `apps/web/e2e/*.spec.ts`          | built server, Chromium, stub upstreams, no keys | yes (job `Web e2e`)   |

- Test files are named `*.test.ts` (`*.test.tsx` in the web app) and sit in `test/` (server, shared) or next to the source (web). Tests run in parallel, so they must not share state: use `PORT=0` (a random free port) and a unique temp directory from `makeTempDir()` in `apps/server/test/helpers.ts`, and clean up in `afterAll`. Never hard-code a port.
- HTTP routes are tested with Fastify `app.inject`. External services (gateway, TorBox, TMDB) are replaced with stubs in unit and integration tests. Real calls belong in `test/live/` only, and use few requests (the gateway allows about 5 requests per 5 seconds).
- Fixtures must never contain real secrets or real stream URLs. Use `example.test` hosts and invented tokens.
- GPU tests start real encoders. Run them alone, one file at a time, never while a game or other GPU-heavy program runs, and with every ffmpeg process stopped at the end. Stop sessions gently with `DELETE /api/sessions/:id` (no body, no content-type) before stopping the server.
- Limit download bandwidth in real-title tests: start the server with `MAX_DOWNLOAD_MBPS=60` or lower (the household shares the connection) and never download whole files for a test.
- Playwright e2e tests run against the built UI and an isolated server with stub TMDB, gateway, Sentry and PostHog (`apps/web/e2e/support/hub.mjs`). They never use real keys and never start a playback session. Install Chromium with `pnpm --filter @homestream/web exec playwright install chromium` (set `PLAYWRIGHT_BROWSERS_PATH` to keep it off the system drive); only the CI job `Web e2e` installs it.
- Coverage thresholds live in `coverage-thresholds.json` of each package and may only be raised (`pnpm coverage:ratchet`).
- CI retries failing tests twice and writes JUnit and JSON reports to `reports/`; see [docs/runbooks/flaky-tests.md](docs/runbooks/flaky-tests.md).
- Port range for anything you start by hand: 8600-8699 (server 8600, web dev 8601, Playwright e2e 8602-8607, Electron remote debugging 8622). Do not use other ports.

## Telemetry rules

Telemetry is Sentry (errors) and PostHog (product analytics). The full description of what is sent is [docs/PRIVACY.md](docs/PRIVACY.md); keep it in sync with the code.

- Telemetry is **off** unless the matching key is set (`SENTRY_DSN_*`, `POSTHOG_API_KEY`), and `HOMESTREAM_TELEMETRY=off` disables all of it.
- Only the typed event catalog may be sent. Add an event to the catalog and to [docs/PRIVACY.md](docs/PRIVACY.md) in the same change.
- No gateway URL, stream URL, API key, IP address, file path or user text is ever sent. Everything passes through the scrubber (`redact()` plus an allow-list for analytics properties).
- Capture is manual only: no autocapture, no session recording, no user identification beyond a random install id.
- Telemetry code never throws into the caller, never blocks the request or playback path, and does nothing when its key is missing.
- Feature flags and experiments: [docs/experimentation.md](docs/experimentation.md).

### Web and desktop apps

- **Keys are baked in at build time** for the web UI (`SENTRY_DSN_WEB`, `POSTHOG_API_KEY`, `POSTHOG_HOST` from the environment or `.env`). A build without them contains no key and makes no telemetry request. `HOMESTREAM_TELEMETRY=off` at build time (the build then holds no key either), or `localStorage['homestream.telemetry']='off'` in one browser, disables it too. Every variable the web build reads is listed in the `build` task `env` of `turbo.json` (a test fails when one is missing), so it reaches `pnpm build`; the web build is never cached. Never fetch keys at run time.
- **Never block Home.** `apps/web/src/telemetry/index.ts` is in the initial bundle and imports no Sentry or PostHog code. The `telemetry-*.js` chunk loads after the `hs:home-content` performance mark (`HOME_CONTENT_MARK`) and browser idle time. The Home screen must set that mark when its rows are rendered.
- **Requests**: call the server through `apiFetch` / `apiGet` (`apps/web/src/api/client.ts`). It adds `X-Request-ID` and throws `ApiError`. Do not call `fetch` for `/api` directly.
- **Logging**: use `logger` (`apps/web/src/logger.ts`, `apps/desktop/src/logger.ts` in the shell). Entries become Sentry breadcrumbs. Log no URLs with tokens, stream URLs or user text.
- **Sentry**: project `homestream-web` for the renderer and the desktop main process, tags `app`, `process` (`renderer` or `main`), `device.kind` and `route`. Every event passes `scrubEvent` (the shared `sanitizeSentryEvent`). The renderer uses `@sentry/react` 11.10, the main process `@sentry/electron` 8.3 (plan in [apps/desktop/README.md](apps/desktop/README.md)).
- **PostHog**: catalog events only, through `captureEvent`. Page views go through `usePageView(location.pathname)` and send the route template (`/movie/:id`), never the real path. No autocapture, session recording or surveys in the renderer. The only flag it reads is `banner-rotation-interval` (`watchFlag` in `src/telemetry/posthog.ts`), inside the lazily loaded telemetry chunk.
- **Test trigger**: `?__telemetry_test=<run id>` reports one deliberate error, but only in a build made with `HOMESTREAM_TELEMETRY_STUB=1` (the e2e `stub` build).
- **Bundle budget**: `apps/web/.size-limit.json` (initial JS 150 kB gzip, telemetry chunk 100 kB; add an entry for each new heavy chunk). CI runs `size`, and `pnpm readiness:audit` fails without it. `pnpm --filter @homestream/web analyze` shows what is in the bundle.
- **Electron**: version 45. The binary is downloaded lazily (there is no install script): keep the cache off the system drive (`ELECTRON_CACHE=E:\HomeStream\cache\electron`) and run `node apps/desktop/node_modules/electron/install.js` once. `apps/web` and `apps/desktop` never import each other.
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

Runbooks for operating the server are indexed in [docs/runbooks/README.md](docs/runbooks/README.md). Other documents: [docs/architecture.md](docs/architecture.md) (diagrams), [docs/database.md](docs/database.md), [docs/PRIVACY.md](docs/PRIVACY.md), [docs/TECH_DEBT.md](docs/TECH_DEBT.md), [docs/ideas.md](docs/ideas.md) (ideas for later, not in scope), [docs/wiki.md](docs/wiki.md).

## CI checks

CI runs these on every push and pull request (the workflows are in `.github/workflows`). Run the same locally before you push:

1. `pnpm format:check`, `pnpm lint`, `pnpm typecheck`
2. `pnpm knip`, `pnpm dup`, `pnpm deps:check`, `pnpm syncpack:lint`, `pnpm techdebt`, `pnpm check:large-files`
3. `pnpm test:ci` and `pnpm test:coverage` (web and desktop included), then the bundle budgets: `pnpm --filter @homestream/web build` and `size`, the same for desktop
4. `pnpm agents:check` and `pnpm docs:check`
5. `pnpm openapi:check` and `pnpm db:schema:check` (generated docs must be committed)

Check CI status with the GitHub CLI (`gh auth status` must succeed first):

```powershell
gh run list --workflow ci.yml --branch main --limit 3      # latest runs on main
gh run watch <run-id> --exit-status                      # wait for a run
gh run view <run-id> --log-failed                        # logs of the failing steps only
gh pr checks <number>                                    # checks of a pull request
gh api repos/VeroxAUS/homestream/branches/main/protection --jq '.required_status_checks.contexts'
```

CI also runs the job `Web e2e` (Playwright, Chromium installed only there) in parallel; it is not a required check.

Three advisory automations ([docs/ci.md](docs/ci.md)) are never required checks and never fail `Linux` or `Windows`:

- **Droid review** (`.github/workflows/droid-review.yml`, secret `FACTORY_API_KEY`): every pull request to main gets review comments and one summary; every push to main gets commit comments on the pushed commit. Fork and Dependabot pull requests skip with a notice.
- **CI timing** (job `CI timing` in `ci.yml`, `node scripts/ci-timing.mjs`): every main run adds one JSON record to the orphan branch `ci-metrics` (never written to main, kept forever) and its job summary compares job, step and test durations with the median of the last 10 main runs; a pull request gets one sticky comment with the same comparison, edited in place.
- **Code health** (`.github/workflows/code-health.yml`, daily and `gh workflow run code-health.yml`): skips when main has no new commit since the SHA stored in the one open issue titled `Code health`, otherwise rewrites that issue with the findings. It pushes no code and opens no pull request.

`Linux` is a gate over the parallel jobs `Linux checks`, `Linux tests` and `Linux secrets` (layout in [docs/ci.md](docs/ci.md#job-layout-and-wall-time)); a red one turns `Linux` red. Branch protection on `main` requires the jobs `Linux` and `Windows`; force pushes and deletions are blocked, the owner may push directly. A push to `main` triggers CI, then `release.yml` (tag, GitHub release, Sentry release) when the commits since the last tag include `feat`, `fix` or `perf`.

GPU and live tests never run in CI. Pre-commit hooks (lefthook, installed by `pnpm install`) run prettier, ESLint, the secret scan and the large-file check on staged files, `pnpm agents:check` when this file changes, and `pnpm docs:check` when markdown changes.
