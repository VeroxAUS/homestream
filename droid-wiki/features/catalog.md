# Catalog metadata
Active contributors: VeroxAUS

The catalog adapts TMDB responses into HomeStream's shared movie, show and episode shapes. It provides metadata, not stream URLs or a browser catalog UI.

## Key abstractions

| Abstraction | Source | Role |
| --- | --- | --- |
| TmdbService | `apps/server/src/tmdb/service.ts` | Home, search, movie, show, season; requests and in-flight sharing |
| TmdbCache | `apps/server/src/tmdb/cache.ts` | SQLite JSON caching and expiry |
| Normalizers | `apps/server/src/tmdb/normalize.ts` | Stable shapes, images, dates, rating and external IDs |
| HTTP adapter | `apps/server/src/routes/catalog.ts` | Validates queries/IDs; returns catalog responses |
| Contracts | `packages/shared/src/catalog.ts` | Request/response schemas and inferred types |

## Request flow

The service fetches TMDB image configuration, then metadata. Home loads weekly trending movies/shows and popular movies/shows in parallel. The route adds `continueWatching: []`; persisted watch progress is not surfaced by this endpoint yet. Search uses `/search/multi`, page 1, adult results disabled, and drops people and any non-movie/non-TV result. Requests use `language=en-US`.

Movie/show details append external IDs; a valid `tt`-prefixed IMDb ID bridges into [stream discovery](stream-selection.md). Show seasons exclude season zero (“Specials”) and sort numerically; the season route still accepts explicit season zero. Episodes are sorted numerically. Missing images become null, title/name fallbacks preserve useful labels, ratings round to one decimal, and positive runtimes round to integer minutes.

Image URLs use configuration's secure base or the default image base, with poster `w342`, backdrop `w1280`, and still `w300`. These are image references, not local image downloads.

## Cache and upstream policy

| Data | TTL |
| --- | --- |
| Home lists | 1 hour |
| Movie/show/season details | 24 hours |
| Image configuration | 24 hours |
| Search | 10 minutes |

`tmdb_cache` stores raw JSON by logical key. Expired or corrupt entries are deleted when read; the cache also exposes explicit expiry purging. Search cache keys collapse whitespace and lowercase the normalized query. Identical concurrent misses share one promise per key; only successful responses are cached, and there is no stale fallback.

A token is required even before serving a cache hit; missing configuration produces 503 `config_missing`. Each network attempt has a 10-second timeout. The service makes at most two attempts with a 300 ms retry delay: network/JSON failures and 429/5xx can retry. TMDB 400/404/422 become not-found; 401 becomes 502 `tmdb_auth_failed`; other failures become 502 `tmdb_unavailable`.

## Change and test entrypoints

Adjust upstream operations/retries in `apps/server/src/tmdb/service.ts`, TTLs/storage in `apps/server/src/tmdb/cache.ts`, normalization in `apps/server/src/tmdb/normalize.ts`, and exposed routes in `apps/server/src/routes/catalog.ts`. Keep [shared contracts](../packages/shared.md) aligned.

Measured subsystem: **3 source files** under `apps/server/src/tmdb/`, **2 dedicated test files** under `apps/server/test/tmdb/`, **1 unique committer** in the scoped source history (`%cn <%ce>`). Counts use tracked `.ts` and `*.test.ts`, excluding `fixtures.ts`, route/shared files and the additional `apps/server/test/live/tmdb.live.test.ts`. Dedicated tests cover normalization, routes, cache persistence/expiry, concurrent sharing and errors. Tests were read, not executed for this documentation.
