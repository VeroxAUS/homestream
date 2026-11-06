# Deployment

Active contributors: VeroxAUS

HomeStream currently runs as one local Node server on the encoding PC. It serves the API, HLS, SSE and optional built React assets; release automation creates tags/releases, not installers or a remotely deployed fleet.

## Supported shape

`apps/server/src/index.ts` is the runtime entry point. The intended playback host is a Windows PC with NVIDIA hardware, FFmpeg/ffprobe and NVENC; offline development/CI also runs on Linux (`README.md`, `.github/workflows/ci.yml`).

The [web app](apps/web/index.md) implements Home, search, movie/show details and Settings. Player and dashboard tabs remain placeholders (`apps/web/src/App.tsx`, `apps/web/src/pages/PlayerPage.tsx`, `apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`). The [Electron 45 package](apps/desktop.md) has logging, request-ID and telemetry helpers, but no working window, tray, supervisor, preload or installer (`apps/desktop/README.md`). Android TV is planned with no app implementation. `.devcontainer/Dockerfile` is a development image, not a production deployment artifact.

## Build and start

Use Node 24, pnpm 12, Git and FFmpeg/ffprobe. Bootstrap preserves an existing `.env` and builds shared contracts:

```powershell
node scripts/bootstrap.mjs
pnpm build
pnpm --filter @homestream/server start
```

Turbo builds dependency outputs first (`turbo.json`). The server compiles to `apps/server/dist`, shared to `packages/shared/dist`, and Vite to `apps/web/dist` (`apps/server/package.json`, `packages/shared/package.json`, `apps/web/package.json`). Preserve workspace package manifests/dependencies as well as outputs; the runtime imports shared's built export.

Set your own upstream credentials and writable dedicated `DATA_DIR` / `TRANSCODE_DIR` in private configuration. Defaults are Windows `E:\HomeStream` locations, so Linux needs explicit absolute paths (`apps/server/src/config.ts`). Missing required upstream keys warn rather than prevent listening. Restart after changing settings; see [configuration](reference/configuration.md).

The default listener is `0.0.0.0:8600`. The source proxy binds `127.0.0.1`, normally port 8650, falling back to a free port if occupied (`apps/server/src/sourceproxy/proxy.ts`). Keep the listener on the trusted LAN and do not port-forward it; there is no authentication or built-in TLS configuration ([security](security.md)).

The server advertises `_homestream._tcp` with mDNS (`apps/server/src/discovery.ts`); failures warn without blocking direct access. Vite on 8601 is a separate development process, not required to serve built assets.

## Startup and state

`apps/server/src/index.ts` loads configuration/logging, builds the dependency graph, recovers old encoders, starts the loopback proxy and public listener, then starts health/download workers and discovery. `apps/server/src/app.ts` owns the service graph.

| Location                               | Lifetime                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `DATA_DIR`                             | SQLite `homestream.db`, operational logs and PID registry; retain across updates        |
| `TRANSCODE_DIR`                        | Disposable per-session encoder output; startup recovery removes leftover subdirectories |
| `apps/web/dist` or configured web root | Built assets; served only when its `index.html` exists                                  |
| Private config file                    | Credentials/settings; preserved independently of releases                               |
| `reports/` and package `coverage/`     | Local/CI diagnostics, not deployment state                                              |

Use a dedicated transcode directory: recovery is allowed to clear its subdirectories (`apps/server/src/playback/pidRegistry.ts`). Do not place unrelated files or durable media there.

`HOMESTREAM_PACKAGED=1` changes repository discovery/config environment behavior; it does not create an installer (`apps/server/src/index.ts`, `apps/server/src/config.ts`).

## Verify and stop cleanly

Check `/healthz`, `/readyz`, `/api/info`, then `/api/health`. The local probes do not validate upstreams or playable media; health checks and a controlled title start test those separately (`apps/server/src/routes/ops.ts`, `apps/server/src/routes/health.ts`).

End sessions with DELETE `/api/sessions/:id` without a body/content-type. SIGINT, SIGTERM, SIGBREAK, IPC `{ type: "shutdown" }`, or `shutdown` on stdin converge on bounded cleanup (`apps/server/src/index.ts`, `apps/server/src/shutdown.ts`). Discovery stops, sessions/proxy close, then owned database/logging/telemetry resources close. Stop manually started processes by PID, never by executable name.

See [monitoring](how-to-monitor/index.md), [health](systems/health.md), and [debugging](how-to-contribute/debugging.md).

## CI and release automation

`.github/workflows/ci.yml` defines required `Linux` and `Windows` checks. Linux runs static/documentation/security gates and offline coverage; Windows typechecks and runs selected unit files. GPU/live never run in CI. This validates source; it does not deploy a server.

After successful CI for a push to `main`, `.github/workflows/release.yml` checks out that run's exact SHA and asks `scripts/next-version.mjs` for a release plan:

| Commit signal since the last reachable release tag       | Version effect |
| -------------------------------------------------------- | -------------- |
| Breaking `!` or `BREAKING CHANGE` footer                 | Major          |
| `feat`                                                   | Minor          |
| `fix`, `perf`                                            | Patch          |
| Only docs/chore/ci/test/refactor/build-style maintenance | No release     |

With no existing release tag, any nonempty commit history produces the initial `v0.1.0`; after that, the bump rules above apply (`scripts/next-version.mjs`). `pnpm release:next` is a local dry-run plan. The workflow creates the GitHub tag/release with notes and registers a Sentry `homestream@<version>` release, commits and production deploy marker. It does **not** install code on a home PC, build/upload installers, or upload source maps.

Server/shared TypeScript builds emit source maps (`apps/server/tsconfig.build.json`, `packages/shared/tsconfig.build.json`). Vite separately supports a **build-time** source-map upload when `HOMESTREAM_RELEASE_BUILD=1`, `SENTRY_AUTH_TOKEN` is present, and telemetry is not disabled. It emits hidden maps, uploads to `homestream-web`, then deletes maps from the web output; ordinary builds emit none (`apps/web/vite.config.ts`). The release workflow does not invoke that web build.

Web telemetry keys are baked into the UI, so changing server runtime configuration does not change an existing bundle (`apps/web/src/telemetry/buildEnv.ts`). Runtime version comes from the server package manifest (`apps/server/src/version.ts`); release planning does not rewrite package versions. A Sentry deploy marker is release metadata, not evidence that a running LAN server was upgraded.

## Rollback

Follow `docs/runbooks/rollback.md`. Prefer `git revert` as a normal history-preserving commit, or reproduce/run a known-good commit in a separate worktree. Never reset published `main` or force-push. Install frozen dependencies, rebuild, run offline checks and restart the server.

Stop the server before a simple database-file backup; SQLite uses WAL (`apps/server/src/db/index.ts`). Back up before crossing a migration boundary and inspect `docs/schema.sql` / `apps/server/src/db/migrations.ts`. Migrations run forward; there is no reverse-migration command or automated backup/restore service. Keep private config outside code rollback. Verify version/health and playback after restart.

## Scheduled documentation delivery

`.github/workflows/droid-wiki-refresh.yml` runs daily at **17:00 UTC** or on manual dispatch, never on push. Its check job compares commits outside `droid-wiki/` since the last successful workflow run on the default branch; no previous success, missing history, or `force=true` causes generation. Otherwise it skips the later jobs.

The read-only `wiki-refresh` job restores pages from **`factory/droid-wiki`**, falling back to main's checkout, installs Droid and runs `droid exec --auto high "/wiki"` using `FACTORY_API_KEY`. Its artifact includes hidden metadata and has **one-day retention**; images/video are excluded. A separate `wiki-publish` job has contents, PR and status write permissions.

`scripts/wiki-mirror.mjs` replaces the wiki with the artifact rather than overlaying it, so dropped pages become deletions. It refuses artifacts without metadata and preserves local images/video folders. Publishing opens/updates **`docs: refresh wiki`**, labels it **`droid-wiki`**, and requests squash merge, using auto-merge for a protected base and retaining the rolling branch.

The optional `FACTORY_WIKI_PR_TOKEN` can create PRs that trigger other workflows; the fallback built-in token does not. Normal CI also ignores wiki-only changes. Publishing therefore posts success statuses named **`Linux`** and **`Windows`** on the generated PR head as not applicable; `REQUIRED_CHECKS` must track the required CI job names. This exception is limited by the PR action's wiki-only add-paths, not the application release path. Rejected PR creation/push or merge is reported with warning annotations; mirror/artifact failures are not covered by that tolerance.

Required repository-side settings include allowing Actions to create PRs and enabling auto-merge when needed (`docs/wiki.md`). Their presence is an operator prerequisite, not something verified by reading the workflow.

## Key source files

| File                                       | Purpose                                                        |
| ------------------------------------------ | -------------------------------------------------------------- |
| `apps/server/src/index.ts`                 | Runtime boot/listen/shutdown                                   |
| `apps/server/src/config.ts`                | Host, storage, credentials and runtime switches                |
| `apps/server/src/playback/pidRegistry.ts`  | Orphan recovery and disposable output cleanup                  |
| `.github/workflows/ci.yml`                 | Source validation                                              |
| `.github/workflows/release.yml`            | Tag, GitHub release and Sentry metadata                        |
| `scripts/next-version.mjs`                 | Conventional Commit version planning                           |
| `docs/runbooks/rollback.md`                | Recovery procedure                                             |
| `.github/workflows/droid-wiki-refresh.yml` | Scheduled wiki publishing                                      |
| `scripts/wiki-mirror.mjs`                  | Replacement mirror with metadata guard and asset exclusions    |
| `apps/web/vite.config.ts`                  | Static build, development proxy and optional source-map upload |
