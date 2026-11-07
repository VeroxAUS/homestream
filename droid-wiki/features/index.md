# Features

Active contributors: VeroxAUS

## Purpose

These pages follow title workflows across server services and clients. Catalog browsing, resume state and download notices feed implemented playback, while the server owns upstream access and media processing (`apps/server/src/app.ts`, `apps/web/src/pages/PlayerPage.tsx`).

## Capability layout

| Feature | Main abstraction and implementation |
| --- | --- |
| [Catalog](catalog.md) | TMDB metadata and Home assembly; `apps/server/src/home/service.ts` |
| [Stream selection](stream-selection.md) | Parsed/ranked candidates; `apps/server/src/streams/service.ts` |
| [Prefetch](prefetch.md) | Cached-source warming without encoders; `apps/server/src/prefetch/service.ts` |
| [Downloads](downloads.md) | Persistent remote-cache tracking; `apps/server/src/downloads/service.ts` |
| [Viewing progress](viewing-progress.md) | Resume, continue watching and up next; `apps/server/src/progress/service.ts` |
| [Playback](../systems/playback/index.md) | Device-compatible HLS and subtitles; `apps/server/src/playback/manager.ts` |

## Main flow

TMDB supplies the IMDb identity for gateway discovery. Selection ranks cached candidates by device tier. Prefetch may warm the recommendation; automatic session start returns a playable session or a 202 tracking response for remote caching. Player pings persist resume/history data used by Home (`apps/server/src/tmdb/service.ts`, `apps/server/src/streams/rank.ts`, `apps/server/src/playback/sessionStart.ts`, `apps/server/src/playback/manager.ts`).

The browser player is implemented. Dashboard tabs alone remain placeholders through `apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`; TV remains planned. Desktop is an implemented shell around the renderer rather than another encoding runtime.

Remote TorBox caching, local proxy byte caching and progressive subtitle extraction are different workflows. In particular, a ready remote download requires a cached gateway listing, and a successful prefetch is not a reserved session.

## Integration and modification

Change pure policies in the owning domain, orchestration in its service, routes under `apps/server/src/routes/`, and wire shapes in [shared contracts](../packages/shared.md). Follow [conventions](../how-to-contribute/patterns-and-conventions.md) rather than embedding domain rules in a handler. Operational history/statistics are local data, not outbound analytics.

## Key source files

| File | Purpose |
| --- | --- |
| `apps/server/src/home/service.ts` | Home aggregation |
| `apps/server/src/streams/rank.ts` | Selection |
| `apps/server/src/prefetch/service.ts` | Warming |
| `apps/server/src/downloads/service.ts` | Remote-cache tracking |
| `apps/server/src/progress/service.ts` | Continue watching |
| `apps/server/src/playback/sessionStart.ts` | Play handoff |

## Measured scope

At `5eefa37`, committed home/tmdb/streams/prefetch/downloads/progress source directories contain **18 `.ts` files**; matching test directories contain **11 `*.test.ts` files**, ratio **0.61**. Method: scoped `git ls-files`, excluding stats, playback, routes, DB/contracts, helpers and integration tests elsewhere. Default-branch history/CODEOWNERS identify **1 unique human author**, excluding bots. File ratios do not measure coverage.
