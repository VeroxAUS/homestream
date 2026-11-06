# Features

Active contributors: VeroxAUS

These pages follow media workflows through the server and clients. Home, search, title details, and Settings have browser screens; the player and dashboard remain placeholders (`apps/web/src/App.tsx`, `apps/web/src/pages/PlayerPage.tsx`, `apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`).

## Capability map

| Capability                               | Implementation                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Catalog](catalog.md)                    | TMDB metadata, search, details, Home rows, featured titles, `apps/server/src/home/service.ts`                 |
| [Stream selection](stream-selection.md)  | URL-free candidates, quality parsing, ranking, automatic source handoff, `apps/server/src/streams/service.ts` |
| [Prefetch](prefetch.md)                  | Flag-gated source/probe warming without an encoder, `apps/server/src/prefetch/service.ts`                     |
| [Downloads](downloads.md)                | Persistent tracking of TorBox upstream caching, `apps/server/src/downloads/service.ts`                        |
| [Viewing progress](viewing-progress.md)  | Resume, up-next, history, statistics, `apps/server/src/progress/service.ts`                                   |
| [Playback](../systems/playback/index.md) | Device output, FFmpeg, HLS and subtitles, `apps/server/src/playback/manager.ts`                               |

## Main flow

Metadata supplies identifiers for gateway discovery. Parsed candidates are ranked for the requested device tier. Prefetch can warm a cached source; session creation either returns a session or starts tracking an upstream download. Progress reports update resume state and the data used by Home (`apps/server/src/tmdb/service.ts`, `apps/server/src/streams/rank.ts`, `apps/server/src/playback/manager.ts`, `apps/server/src/home/service.ts`).

Current browser Play actions construct links with resume positions, but the player route does not yet start sessions. Download badges update through deferred SSE invalidations (`apps/web/src/components/PlayActions.tsx`, `apps/web/src/pages/PlayerPage.tsx`, `apps/web/src/events/serverEvents.ts`).

The [source proxy](../systems/source-proxy.md) caches byte ranges locally. TorBox download tracking means remote caching, not a complete media download to the PC.

## Modification entry points

Change pure rules in the domain directory, orchestration in its service, HTTP validation in `apps/server/src/routes/`, and wire shapes in [shared contracts](../packages/shared.md). Use [API](../api/index.md) for endpoint contracts and [testing](../how-to-contribute/testing.md) for isolated fixtures.

## Key source files

| File                                   | Purpose                    |
| -------------------------------------- | -------------------------- |
| `apps/server/src/home/service.ts`      | Home orchestration         |
| `apps/server/src/streams/rank.ts`      | Source ranking policy      |
| `apps/server/src/prefetch/service.ts`  | Speculative warming        |
| `apps/server/src/downloads/service.ts` | Upstream caching jobs      |
| `apps/server/src/progress/service.ts`  | Continue-watching entries  |
| `apps/server/src/stats/aggregate.ts`   | History-derived statistics |
| `apps/web/src/api/queries.ts`          | Browser feature queries    |

## Measured scope

The server source directories tmdb, home, streams, prefetch, downloads, progress and stats contain **20 TypeScript files**. Matching test directories contain **12 test files**, a **0.60 test-to-code file ratio**. Counts exclude routes, DB helpers, shared schemas, playback and integration/GPU/live tests outside the matching directories. These file ratios do not measure coverage. Default-branch history has one unique human author, excluding bots; see [statistics](../by-the-numbers.md).
