# Gateway discovery
Active contributors: VeroxAUS

The gateway client retrieves direct HTTP(S) source candidates from the configured Stremio-compatible gateway. It centralizes lookup throttling, persistent caching, deduplication and upstream error handling; media-byte delivery belongs to the source proxy.

## Key abstractions

| Abstraction | Source | Responsibility |
| --- | --- | --- |
| GatewayClient | `apps/server/src/gateway/client.ts` | Configuration, request sharing, fetch/parse, statistics |
| GatewayCache | `apps/server/src/gateway/cache.ts` | SQLite lookup rows, TTLs and reverse stream-ID lookup |
| RateLimiter | `apps/server/src/gateway/rateLimiter.ts` | FIFO sliding-window task-start limits |
| Query and identity helpers | `apps/server/src/gateway/types.ts` | Movie/TV queries, path/key conversion, URL hash IDs |

## Lookup flow

`lookup` requires `GATEWAY_MANIFEST_URL`, strips a trailing `/manifest.json` and its optional query/fragment, then removes trailing slashes. It constructs `stream/movie/<IMDb>.json` or `stream/series/<IMDb>:<season>:<episode>.json`; it does not fetch or interpret the manifest first.

Fresh SQLite hits bypass networking. Identical concurrent misses share one promise by query key. Distinct misses enter the client's shared limiter. Defaults allow **5 starts per 5000 ms**, with a **150 ms margin**, in FIFO order. This limits task starts, not concurrent requests, and is process/client-local rather than a cross-process quota.

Each fetch accepts JSON and has a **30-second timeout** once dispatched. Queue waiting is outside that timeout. The client performs **no automatic retry**: network/timeouts, HTTP errors or malformed responses fail the lookup without caching failure.

Missing configuration returns 503 `config_missing`. Upstream problems return 502 `gateway_unavailable`; 429 hints at waiting, while 401/403/404 hint at checking configuration. Client statistics record requests, errors, latest latency/lookup time and last error; cache hits do not count as requests. Latency starts at dispatched fetch, not queue admission.

## Response and cache policy

The response must contain a `streams` array. Entries need an HTTP(S) URL; info-only/non-HTTP entries are discarded. Duplicate URLs collapse through the first 16 hexadecimal characters of SHA-256 of the raw URL. Filename uses a nonempty behavior hint or a decoded final URL path component. Positive finite size hints are rounded; missing/invalid sizes become zero.

| Cache rule | Behavior |
| --- | --- |
| Nonempty results | Fresh for 60 minutes |
| Empty results | Fresh for 5 minutes |
| Expired reads | Not used by normal lookup; retained for reverse-ID refresh |
| Reverse lookup | Validates 16-hex ID, searches rows then verifies parsed array membership |
| Explicit purge | Deletes rows expired for at least 7 days; not a guaranteed scheduled retention bound |

Cache rows keep server-side URLs. [Stream selection](../features/stream-selection.md) maps them to URL-free public metadata and uses expired rows to reconstruct/refetch the original lookup when resolving a previously listed ID. The ID is opaque to clients but is not a credential or an encryption scheme.

## Integration and changes

`apps/server/src/app.ts` constructs one client shared by StreamService, playback and prefetch paths, and closes its limiter if the app owns the client. The limiter's close clears queued tasks/timer; it does not abort already-running fetches. Edit transport/parsing in `apps/server/src/gateway/client.ts`, TTL/reverse mapping in `apps/server/src/gateway/cache.ts`, dispatch policy in `apps/server/src/gateway/rateLimiter.ts`, and identities/paths in `apps/server/src/gateway/types.ts`.

Preserve server-only URLs when changing contracts or logs. See [source proxy](source-proxy.md) for byte resolution/delivery and [API](../api/index.md) for the public boundary.

Measured subsystem: **4 source files**, **2 dedicated test files**, **1 unique committer**. Counts use tracked `.ts` in `apps/server/src/gateway/`, `*.test.ts` in `apps/server/test/gateway/`, and distinct `%cn <%ce>` source-history identities; `stubGateway.ts` and downstream/live tests are excluded. Dedicated tests cover paths, parsing, throttling, sharing, TTLs and failure mapping. Tests were read, not executed for this documentation; no live gateway requests were made.
