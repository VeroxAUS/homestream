# HomeStream

HomeStream is a LAN media server. A Windows PC finds stream sources, re-encodes video with FFmpeg and NVIDIA NVENC, and serves HLS. The React web app has Home, search, title details, and Settings screens; its player and dashboard tabs are placeholders. The Electron package contains support modules, not a working window or supervisor yet (`apps/server/src/app.ts`, `apps/web/src/App.tsx`, `apps/web/src/pages/PlayerPage.tsx`, `apps/desktop/src/index.ts`).

## Start here

- [Architecture](architecture.md): runtimes, service boundaries, and playback flow.
- [Getting started](getting-started.md): install, configure, test, and run.
- [Apps](../apps/index.md): server, browser UI, and desktop status.
- [Playback](../systems/playback/index.md): encoding, seeking, subtitles, and resource limits.
- [Features](../features/index.md): metadata, stream selection, downloads, and viewing progress.
- [API](../api/index.md): HTTP, HLS, events, and shared contracts.
- [Contributing](../how-to-contribute/index.md): workflow, conventions, and checks.

## Product boundaries

There are no user accounts. Device identity records client capabilities, not authentication. Clients request `streamId: "auto"`; the PC always re-encodes video. Do not expose the listener to the internet (`AGENTS.md`).

Four workspaces exist: `apps/server`, `apps/web`, `apps/desktop`, and `packages/shared`. The Google TV app is planned, with no `apps/tv` implementation in this checkout (`pnpm-workspace.yaml`, `README.md`).

TMDB supplies metadata, a configured AIOStreams gateway supplies source candidates, and TorBox optionally caches unavailable titles upstream. SQLite persists local state. Sentry and PostHog are optional and disabled without matching keys (`apps/server/src/app.ts`, `apps/server/src/telemetry/index.ts`). See [security](../security.md) before deployment.

## Snapshot

This wiki describes commit `7eb94bafed5e0e046987a81d0cbbff8e6ba999d1`. [Statistics](../by-the-numbers.md) records its measurement scope; [lore](../lore.md) uses git timestamps for history. Maintained operational documents are under `docs/`; scheduled generation is described in `docs/wiki.md`.
