# HomeStream

HomeStream is a LAN media server. A Windows PC finds a source, re-encodes video with FFmpeg and NVIDIA NVENC, and serves HLS to thin clients. The React UI includes browsing, navigation search, cast and similar titles, spoiler protection, playback, and Settings; the Electron shell adds a tray, server supervision, and a mini player (`apps/server/src/app.ts`, `apps/web/src/App.tsx`, `apps/desktop/src/main.ts`).

## Start here

- [Architecture](architecture.md): runtimes, boundaries, and playback flow.
- [Getting started](getting-started.md): install, configure, build, and run.
- [Glossary](glossary.md): domain terms used throughout the code.
- [Apps](../apps/index.md): the server, browser UI, and desktop shell.
- [Playback](../systems/playback/index.md): sessions, encoders, HLS, and subtitles.
- [Features](../features/index.md): catalog, source selection, prefetch, downloads, and progress.
- [API](../api/index.md): shared contracts, HTTP, HLS, and events.
- [Contributing](../how-to-contribute/index.md): workflow and checks.
- [Packages](../packages/index.md): shared contracts and cross-runtime building blocks.
- [Reference](../reference/index.md): settings, durable models, and dependencies.
- [Cleanup opportunities](../cleanup-opportunities.md): verified maintenance work.

## Product boundaries

There are no accounts or authentication. Devices record capabilities, not permission to access the server. Clients request `streamId: "auto"`, and video is always re-encoded on the PC. Keep the server on a trusted local network, never exposed to the internet (`AGENTS.md`, `apps/server/src/app.ts`).

TMDB supplies metadata, an AIOStreams gateway supplies source candidates, and TorBox optionally caches unavailable titles upstream. Local SQLite stores devices, viewing history, progress, events, and cache records (`apps/server/src/app.ts`, `apps/server/src/db/migrations.ts`). Optional Sentry and PostHog integrations remain off without matching keys; see [telemetry](../systems/telemetry.md).

## Implementation status

Four workspaces exist: `apps/server`, `apps/web`, `apps/desktop`, and `packages/shared` (`pnpm-workspace.yaml`). The TV app is planned, with no implementation directory. Dashboard tabs remain placeholders, but the browser player and desktop shell are implemented (`apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`, `apps/web/src/pages/PlayerPage.tsx`, `apps/desktop/src/shell/shell.ts`). The status table in `README.md` lags these implementations.

Settings now separates device and desktop preferences from an About tab. Spoiler hiding is a browser-local choice, enabled by default, not a server setting (`apps/web/src/pages/SettingsPage.tsx`, `apps/web/src/lib/spoilers.ts`). These screens share the same implementation in the browser and desktop renderer.

This wiki describes commit `0b766e2f21a19468e04d0a9c7352c635a4357c87`. This incremental refresh preserves unaffected pages and their original measurement dates. [Statistics](../by-the-numbers.md) defines the current measurement scope, and [lore](../lore.md) follows git timestamps. Maintained docs and runbooks live under `docs/`; automated refresh is explained in `docs/wiki.md`.
