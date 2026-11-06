# Gateway

Active contributors: VeroxAUS

## Purpose

The gateway client discovers HTTP(S) sources and checks the first response of an uncached playback link. It centralizes persistent list caching, request sharing and one process-local limiter; media-byte delivery belongs to the [source proxy](source-proxy.md) (`apps/server/src/gateway/client.ts`).

## Lookup and structured metadata

`GatewayClient` in `apps/server/src/gateway/client.ts` requires `GATEWAY_MANIFEST_URL`, removes the manifest suffix/trailing slashes, then constructs movie or series stream paths. It does not fetch/interpret the manifest first. Query/key/path helpers are in `apps/server/src/gateway/types.ts`.

`parseGatewayResponse` requires a `streams` array, discards entries without HTTP(S) URLs, and deduplicates by the first **16 hex characters of SHA-256 of the raw URL**. A nonempty filename hint wins over the decoded final URL path component. A positive size hint wins over structured size; invalid/missing values become zero.

Every client lookup/probe sends `AIOStreams-HomeStream/1.0` so AIOStreams can include structured `streamData`. Parsing retains only the needed cached flag, validated 40-hex info hash, nonnegative file index, kind and size. The structured cached flag takes precedence over legacy name markers downstream (`apps/server/src/gateway/client.ts`, `apps/server/src/streams/parse.ts`). Raw URLs and hashes remain server-side; public metadata comes from [stream selection](../features/stream-selection.md).

## Cache and in-flight sharing

`GatewayCache` in `apps/server/src/gateway/cache.ts` persists lookup JSON in SQLite:

| Policy         | Behavior                                                                         |
| -------------- | -------------------------------------------------------------------------------- |
| Nonempty list  | Fresh for **60 minutes**                                                         |
| Empty list     | Fresh for **5 minutes**                                                          |
| Expired row    | Retained to reverse-map earlier stream IDs; not served as fresh                  |
| Reverse lookup | Validate 16-hex ID, find matching JSON rows, verify parsed membership            |
| Explicit purge | Delete rows expired for at least **7 days**; not a scheduled retention guarantee |

Fresh hits avoid networking. Concurrent identical misses share a promise by query key. Forced-fresh lookups bypass the cache and share a separate `fresh:` in-flight key, so normal and forced-fresh requests need not merge; both update the same stored row (`apps/server/src/gateway/client.ts`).

`StreamService.getStreamById` can reconstruct/refetch an expired lookup from its query key. Download confirmation uses forced-fresh lookup to notice a newly cached source (`apps/server/src/streams/service.ts`).

## Shared limiter and transport

`RateLimiter` in `apps/server/src/gateway/rateLimiter.ts` dispatches FIFO task starts: **5 per 5000 ms**, with a **150 ms margin**. It limits starts, not concurrency, and is local to the client/process rather than a cross-process upstream quota.

`apps/server/src/app.ts` constructs one gateway shared by streams, prefetch and downloads. Cache-miss discovery and download-start playback probes use its limiter. Cached reads do not; ordinary URL resolution/media-byte reads use the proxy/resolver path instead of this discovery limiter.

A dispatched list request has a **30-second** timeout; queue waiting is outside that timeout. There is **no automatic lookup retry**. Missing configuration produces 503 `config_missing`; timeout/network/HTTP/JSON failures produce 502 `gateway_unavailable`, with hints for rate limits or refused configuration. Failed requests are not cached (`apps/server/src/gateway/client.ts`).

Lookup statistics include requests/errors, latest dispatch-to-result latency, last lookup/error and cache hits/misses. The playback probe path does not increment these lookup totals. App metrics and health consume the same client's state (`apps/server/src/app.ts`).

## Playback-link probe

`probePlayback` in `apps/server/src/gateway/client.ts` makes a range GET with manual redirects and a **60-second** dispatch timeout. It cancels the body, inspects only the first response, and never requests the redirect target. HTTP 200/206 or a non-placeholder redirect is available; known same-host placeholder redirects carry their clip name; timeouts/rate limits/failures have distinct outcomes.

`placeholderName` in `apps/server/src/playback/resolveUrl.ts` recognizes same-host `/static/<reason>.mp4` clips. [Downloads](../features/downloads.md) interprets these outcomes to accept tracking or return errors. This probe can cause the gateway to add a remote TorBox job; it is not a read-only list lookup.

## Modification entry points and ownership

Change transport/parsing in `apps/server/src/gateway/client.ts`, expiry/reverse identity in `apps/server/src/gateway/cache.ts`, and dispatch policy in `apps/server/src/gateway/rateLimiter.ts`. Preserve server-only URLs and the single shared limiter.

The app closes the client only when it created it. Limiter close clears queued tasks/timers but does not abort running requests (`apps/server/src/app.ts`, `apps/server/src/gateway/rateLimiter.ts`). See [configuration](../reference/configuration.md) and [API](../api/index.md).

## Tested boundaries

FIFO starts, sliding-window limits, failed tasks and rejection of new work after close are tested in `apps/server/test/gateway/rateLimiter.test.ts`. Stub-HTTP integration covers movie/series paths, concurrent lookup sharing, both cache TTLs, burst arrivals, invalid responses, missing configuration and uncached failures (`apps/server/test/integration/gateway-client.test.ts`).

Download integration tests verify the single range GET, manual redirects and failure outcomes before tracking is accepted (`apps/server/test/integration/downloads.test.ts`). These boundaries do not prove live provider availability; the separate opt-in live tier owns that check.

## Key source files

| File                                                  | Purpose                                            |
| ----------------------------------------------------- | -------------------------------------------------- |
| `apps/server/src/gateway/client.ts`                   | Lookup, probe, parsing, sharing and statistics     |
| `apps/server/src/gateway/cache.ts`                    | Persistent TTL and reverse-ID cache                |
| `apps/server/src/gateway/rateLimiter.ts`              | FIFO sliding-window starts                         |
| `apps/server/src/gateway/types.ts`                    | Query identities, URL hashes and user agent        |
| `apps/server/src/streams/service.ts`                  | URL-free metadata and expired-ID refresh           |
| `apps/server/test/gateway/rateLimiter.test.ts`        | Dispatch policy                                    |
| `apps/server/test/integration/gateway-client.test.ts` | Parsing, caching, sharing and errors               |
| `apps/server/test/integration/downloads.test.ts`      | Structured metadata and playback-probe integration |

## Measured scope

`apps/server/src/gateway/`: **4 source files**. Direct tests: **2 files**, counting `apps/server/test/gateway/*.test.ts` plus `apps/server/test/integration/gateway-client.test.ts`; **0.50 test-to-code file ratio** (test files divided by source files). Download/live tests and stub helpers are excluded from this count. Default-branch history has **1 unique human committer**, VeroxAUS, excluding bots. No live gateway calls were made for this documentation.
