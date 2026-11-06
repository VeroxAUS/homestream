# Stream selection
Active contributors: VeroxAUS

Stream discovery converts gateway results into URL-free options and recommends a source by display resolution. It does not itself probe the media or decide the encoder's output codec.

## Key abstractions

| Abstraction | Source | Responsibility |
| --- | --- | --- |
| StreamService | `apps/server/src/streams/service.ts` | Lists, fresh-cache-only reads, server-only URL resolution |
| Filename parser | `apps/server/src/streams/parse.ts` | Quality, audio, language, size and display labels |
| Ranking/recommendation | `apps/server/src/streams/rank.ts` | Cached filtering, stable ordering and device tiers |
| Episode matcher | `apps/server/src/streams/episode.ts` | Rejects explicit contradictory TV markers |
| Routes | `apps/server/src/routes/streams.ts` | TMDB-to-IMDb bridge and device query validation |
| Public contracts | `packages/shared/src/streams.ts` | StreamOption and StreamsResponse; no upstream URL field |

## Discovery and parsing

Movie/TV routes resolve TMDB details first; missing IMDb IDs return an empty list with `recommendedId: null` and `reason: no_streams`. Otherwise [the gateway](../systems/gateway.md) looks up the IMDb title/episode. Invalid requests fail before discovery; upstream errors propagate as HTTP errors rather than a successful empty result.

For TV, explicit `SxxEyy` (including episode ranges), `1x02`, season ranges and season-only markers must agree with the request. Unmarked names remain eligible; this is contradiction filtering, not guaranteed episode verification.

Parsing normalizes filename separators and derives resolution, video codec, HDR, source, audio/channels and language tags. Resolution buckets are 2160p/1080p/720p/480p/unknown; low-resolution markers collapse to 480p and explicit 1440p remains unknown. Lower known tiers default to SDR without an HDR marker; 2160p/unknown do not. A lightning marker in the gateway name means cached on TorBox; this is gateway metadata, not a fresh availability probe. Human labels combine parsed values and cache state.

## Exact ranking policy

1. If any relevant candidate is cached, remove every uncached candidate. Otherwise retain all uncached candidates.
2. Sort by resolution descending: 2160p, 1080p, 720p, 480p, unknown.
3. Within a resolution, sort source quality: Remux, BluRay, WEB-DL, WEBRip, HDTV, then unranked values such as DVD/Unknown.
4. Preserve original gateway order for remaining ties. Size, codec, HDR, audio and language do not break ties.

Without a known registered device, recommend the first ranked option. With a profile, derive width and height tiers independently and take their minimum: 3840/2160 for 4K, 1920/1080 for 1080p, 1280/720 for 720p, otherwise the lowest tier. Recommend the first option at or below that tier; unknown resolution has rank zero and fits. If none fits, choose the first-ranked option at the lowest available resolution. Codec/HDR support affects later [playback decisions](../systems/playback/index.md), not this recommendation.

## Privacy and cached identity

Public options contain metadata and a 16-hex ID, never the raw gateway URL. `getStreamById` is a server-only operation: locate the originating cache row, use its URL while fresh, or re-fetch the original lookup when expired. If the ID is unknown or disappears, return null. IDs derive from the URL, so a changed URL can change identity. `cachedList` only consults a fresh row and never starts or waits for network discovery.

## Modification and measurement

Change token heuristics in `apps/server/src/streams/parse.ts`, recommendation policy in `apps/server/src/streams/rank.ts`, episode handling in `apps/server/src/streams/episode.ts`, and orchestration in `apps/server/src/streams/service.ts`. Preserve the URL boundary and extend fixtures/tests with each parsing change. [Prefetch](prefetch.md) uses the same recommendation.

Measured subsystem: **4 source files**, **4 dedicated test files**, **1 unique committer**. Scope is tracked `.ts` in `apps/server/src/streams/`, tracked `*.test.ts` in `apps/server/test/streams/`, and distinct `%cn <%ce>` source-history identities. The fixture, route/shared modules and additional `apps/server/test/live/streams.live.test.ts` are excluded. Tests cover parsing, ranking, episode matching, routes, privacy and expired-ID refresh; they were not run for this documentation.
