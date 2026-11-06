# HomeStream

HomeStream is a home media server. A Windows PC runs the server, finds a stream for the title you pick, re-encodes it with ffmpeg and NVENC, and serves it as HLS. Clients on the local network (web UI, desktop shell, Google TV app) only play what the server hands them.

- Movie and show data comes from [TMDB](https://www.themoviedb.org).
- Stream sources come from an [AIOStreams](https://github.com/Viren070/AIOStreams) gateway you configure.
- Titles with no cached stream can be cached through [TorBox](https://torbox.app).
- There are no user accounts. A device is the only "who", and the server is for your local network only.

## Status

| Part           | State                                                                              |
| -------------- | ---------------------------------------------------------------------------------- |
| `apps/server`  | Working: catalog, playback, health checks, downloads, event log                    |
| `apps/web`     | Early: build, test, telemetry and e2e setup are in place, the UI is being built    |
| `apps/desktop` | Skeleton: telemetry plan and tests are in place, the Electron shell is being built |
| `apps/tv`      | Planned                                                                            |

## Quick start

You need:

- **Node.js 24** (see `.nvmrc`) and **pnpm 12**. `corepack enable` provides pnpm.
- **ffmpeg and ffprobe** on your `PATH`. Playback needs a build with NVENC (NVIDIA GPU). Development, unit tests and integration tests do not.
- Git.

Then, from a fresh clone:

```powershell
node scripts/bootstrap.mjs
```

`pnpm bootstrap` does the same once dependencies are installed. The script checks your tools, runs `pnpm install`, installs the git hooks, creates `.env` from [.env.example](.env.example) (it never overwrites an existing `.env`), builds `@homestream/shared`, and prints the next steps. The first run is the only setup you need.

Prefer a container? Open the repository in a dev container ([.devcontainer](.devcontainer/devcontainer.json)). It has Node 24, pnpm and ffmpeg (without a GPU), and runs the bootstrap script for you.

## Configure

Edit `.env` in the repository root. [.env.example](.env.example) lists every setting with a comment. A new install needs two:

- `GATEWAY_MANIFEST_URL`: the manifest URL of your AIOStreams gateway.
- `TMDB_READ_TOKEN`: a TMDB API Read Access Token.

`TORBOX_API_KEY` is optional and enables caching titles that no cached stream exists for. The packaged desktop app reads `%APPDATA%\HomeStream\config.env` instead. `.env` is ignored by git: never commit it or paste its values anywhere.

## Run

```powershell
pnpm build
pnpm --filter @homestream/server start
```

The server listens on port 8600 and serves the web UI at `http://localhost:8600/`. For web development run `pnpm --filter @homestream/web dev` (port 8601, proxies `/api` and `/hls` to the server).

The API reference is served at `http://localhost:8600/api/docs` (Swagger UI) and `http://localhost:8600/api/docs/json` while the server runs. A copy is committed as [docs/openapi.json](docs/openapi.json).

Check that everything the server depends on is healthy:

```powershell
curl.exe http://localhost:8600/api/health
```

## Test

| Command                                  | What it runs                                                                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:unit`                         | Fast tests. No network, no GPU, no keys.                                                                                                                       |
| `pnpm test:integration`                  | HTTP tests with a stub gateway and fake encoders.                                                                                                              |
| `pnpm test:ci`                           | Unit and integration together (what CI runs).                                                                                                                  |
| `pnpm test:coverage`                     | The same with coverage thresholds that only go up.                                                                                                             |
| `pnpm test:gpu`                          | Real ffmpeg/NVENC encodes. NVIDIA GPU machine only.                                                                                                            |
| `pnpm test:live`                         | Real TMDB and gateway calls. Needs keys in `.env`.                                                                                                             |
| `pnpm --filter @homestream/web test:e2e` | Browser tests of the web UI against an isolated server with stub upstreams (needs Chromium: `pnpm --filter @homestream/web exec playwright install chromium`). |

Before you commit, run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm knip`, `pnpm test:ci`. The full list of checks is in [AGENTS.md](AGENTS.md#ci-checks).

## Repository layout

| Path              | Contents                                                    |
| ----------------- | ----------------------------------------------------------- |
| `apps/server`     | Fastify 5 + TypeScript server (`node:sqlite`, ffmpeg)       |
| `apps/web`        | React 19 + Vite web UI ([README](apps/web/README.md))       |
| `apps/desktop`    | Electron desktop shell ([README](apps/desktop/README.md))   |
| `packages/shared` | zod schemas and types shared by the server and every client |
| `scripts`         | Repository tooling (bootstrap, checks, reports)             |
| `docs`            | Architecture, database, API export, privacy, runbooks       |

## Documentation

- [Architecture](docs/architecture.md): components, playback sequence, source proxy, database, telemetry and CI flow, as diagrams.
- [Database](docs/database.md) and [schema](docs/schema.sql).
- [API reference](docs/openapi.json) (OpenAPI 3).
- [Runbooks](docs/runbooks/README.md): what to do when the gateway is down, ffmpeg misbehaves, the disk is full, and more.
- [Privacy and telemetry](docs/PRIVACY.md): exactly what leaves your machine, and how to turn it off.
- [Experimentation](docs/experimentation.md): feature flags and experiments.
- [Technical debt register](docs/TECH_DEBT.md).
- [Repository wiki](docs/wiki.md): the generated code wiki and how it is refreshed.
- [AGENTS.md](AGENTS.md): conventions and commands for AI coding agents and contributors.

## Privacy

HomeStream sends nothing unless you set telemetry keys. With keys set, it sends error reports (Sentry) and anonymous usage events (PostHog) that never contain stream URLs, keys, file paths or IP addresses. Set `HOMESTREAM_TELEMETRY=off` to disable everything. Details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Report security problems as described in [SECURITY.md](SECURITY.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[GPL-3.0](LICENSE). Copyright (C) 2026 VeroxAUS.
