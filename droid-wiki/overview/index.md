# HomeStream

HomeStream is a local-network media server. A Windows PC discovers sources through a configured gateway, re-encodes video with FFmpeg and NVIDIA NVENC, and serves HLS to clients. The server works; the React web UI still shows a placeholder (`README.md`, `apps/server/src/app.ts`, `apps/web/src/App.tsx`).

## Start here

- [Architecture](architecture.md): process boundaries and playback flow.
- [Getting started](getting-started.md): install, configure, build, and run.
- [Playback](../systems/playback/index.md): sessions, encoding, seeking, and subtitles.
- [Features](../features/index.md): catalog, source selection, caching, and viewing progress.
- [API](../api/index.md): HTTP endpoints, HLS, and server-sent events.
- [Contributing](../how-to-contribute/index.md): workflow, conventions, and checks.

## Current scope

The implemented workspaces are `apps/server`, `apps/web`, and `packages/shared`. Desktop and Google TV clients are planned, not shipped applications in this checkout (`README.md`, `pnpm-workspace.yaml`). There are no user accounts. Device capabilities guide encoding; device identity is not authentication.

The server combines SQLite persistence, TMDB metadata, gateway discovery, a loopback source proxy, playback management, TorBox download tracking, health checks, viewing history, and optional telemetry in one process (`apps/server/src/app.ts`). Clients should request `streamId: "auto"`; the PC always re-encodes video (`AGENTS.md`).

## Documentation snapshot

Generated from commit `bb48e6d9f6c0eb098ae6e3ea29ded95fd991d406` on 2026-11-06. This replaces a baseline whose recorded commit is absent from the available git history. [Statistics](../by-the-numbers.md) describes measurement scope; [lore](../lore.md) follows the available dated history.

The maintained operational documents live under `docs/`; this generated wiki explains the implementation. See `docs/wiki.md` for the scheduled refresh workflow. Never expose the server directly to the internet. Read [security](../security.md) before deploying it.
