# HomeStream

HomeStream is a LAN media server that combines TMDB catalog metadata, gateway stream discovery, and device-specific HLS transcoding. The Fastify server is implemented; the React web client currently renders a placeholder (`apps/server/src/app.ts`, `apps/web/src/App.tsx`).

## Start here

- [Architecture](architecture.md): components and request flow.
- [Getting started](getting-started.md): install, configure, build, and run.
- [Playback](../systems/playback/index.md): sessions, encoding, seeking, and subtitles.
- [API](../api/index.md): HTTP and event interfaces.
- [Contributing](../how-to-contribute/index.md): development and validation.

## Current scope

The existing workspaces are `apps/server`, `apps/web`, and `packages/shared`. `pnpm-workspace.yaml` also lists `apps/desktop`, but that directory does not exist in this checkout. No TV application is present. Do not interpret these configuration entries as shipped clients.

The server composes SQLite persistence, metadata and gateway clients, a loopback source proxy, playback management, and prefetching in `apps/server/src/app.ts`. Shared Zod schemas describe catalog, device, stream, and playback contracts in `packages/shared/src/index.ts`.

## Snapshot

This wiki describes the working tree at commit `b2a0afd75d49a46d24a6895ef17ce4d4f6d7ecaf` on 2026-11-05, including pre-existing uncommitted edits to `apps/server/src/playback/ffmpegArgs.ts` and `apps/server/test/playback/ffmpegArgs.test.ts`. Those edits were not changed by wiki generation. See [history](../lore.md) and [statistics](../by-the-numbers.md).
