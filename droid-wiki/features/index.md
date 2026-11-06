# Features
Active contributors: VeroxAUS

Implemented capabilities are server-side. The browser UI remains a placeholder; these pages document service behavior, not completed user-facing screens.

## Capability map

| Capability | Key abstraction and source | Integration |
| --- | --- | --- |
| [Catalog](catalog.md) | TmdbService, `apps/server/src/tmdb/service.ts` | Metadata, home rows, search and details |
| [Stream selection](stream-selection.md) | StreamService, `apps/server/src/streams/service.ts` | Gateway parsing, filtering, ranking and recommendations |
| [Prefetch](prefetch.md) | PrefetchService, `apps/server/src/prefetch/service.ts` | Speculative source/probe warming without a playback session |
| [Playback](../systems/playback/index.md) | PlaybackManager, `apps/server/src/playback/manager.ts` | Sessions, encoding and delivery; documented separately |

## Flow and modification

Catalog details supply an IMDb ID for gateway discovery. Stream metadata is ranked for a registered device's display tier. Prefetch can warm the recommended cached source; playback then shares the source proxy. See [architecture](../overview/architecture.md) for the whole graph.

Change normalization and metadata policy in `apps/server/src/tmdb/`, stream interpretation/recommendation in `apps/server/src/streams/`, and speculative scheduling in `apps/server/src/prefetch/`. Request parsing belongs in corresponding `apps/server/src/routes/` files and cross-runtime shapes in [shared contracts](../packages/shared.md).

## Measured scope

The three feature directories above, excluding playback, contain **8 production source files** (TMDB 3, streams 4, prefetch 1), **7 dedicated test files** (2, 4, 1), and **1 unique committer** across their source history. Counts use tracked `.ts` source files and `*.test.ts` in matching `apps/server/test/tmdb/`, `apps/server/test/streams/`, and `apps/server/test/prefetch/`; fixtures/helpers and route/shared files are not included. Two additional live tests in `apps/server/test/live/` exercise TMDB and streams but are outside the dedicated count. Committers are distinct `%cn <%ce>` Git identities, not summed per directory.
