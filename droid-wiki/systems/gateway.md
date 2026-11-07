# Gateway

Active contributors: VeroxAUS

## Purpose

The gateway discovers server-side source URLs and checks playback links without accepting downloading clips as titles. `GatewayClient` in `apps/server/src/gateway/client.ts` shares caching and rate-limited discovery across stream selection, prefetch and downloads.

## Layout and discovery

`parseGatewayResponse` in `apps/server/src/gateway/client.ts` requires a streams array, retains HTTP(S) entries and deduplicates by URL-derived ID. `apps/server/src/gateway/types.ts` defines query keys, provider paths and IDs. Public options contain metadata and IDs; raw links stay on the server.

The parser keeps filename/size hints and a small structured metadata allowlist: cached status, validated torrent hash, file index, kind and size. Structured cached false is meaningful and overrides legacy name markers in `apps/server/src/streams/parse.ts`.

`GatewayCache` in `apps/server/src/gateway/cache.ts` stores raw list JSON in SQLite. Nonempty lists are fresh for **60 minutes**, empty lists for **five minutes**. Expired rows can still trace old stream IDs but are not fresh responses.

Concurrent identical cache misses share work. Forced-fresh lookup uses a separate in-flight key and updates the same persistent row (`apps/server/src/gateway/client.ts`). Downloads use it to confirm newly cached sources.

## Request scheduling

`RateLimiter` in `apps/server/src/gateway/rateLimiter.ts` starts FIFO tasks under a five-per-five-seconds policy with margin. This limits dispatch starts, not active HTTP concurrency or upstream traffic from other processes.

List requests have a **30-second dispatched timeout** and no automatic lookup retry. Missing configuration gives 503; transport/status/JSON problems give redacted gateway errors with hints (`apps/server/src/gateway/client.ts`). Queue wait is outside request timeout.

The client is shared by composition in `apps/server/src/app.ts`. Ordinary media URL resolution and remote body reads are separate from discovery/probe scheduling.

## Placeholder-aware playback probes

`probePlaybackLink` in `apps/server/src/gateway/playbackProbe.ts` manually follows ranged GET responses, requesting only byte zero and cancelling bodies. It follows up to eight redirects under one default **60-second** probe deadline, checking every Location before requesting it.

`placeholderName` in `apps/server/src/playback/placeholder.ts` recognizes a path ending in `/static/<reason>.mp4`, regardless of host, prefix, query or relative Location. A downloading clip behind multiple redirects is rejected before fetching that clip.

The same module's size rule recognizes directly served clips: for a known listing at least **20 MiB**, an actual positive file size below **10%** of the listing is implausible. HTTP 206 uses Content-Range total, not the one-byte Content-Length (`apps/server/src/gateway/playbackProbe.ts`).

| Outcome | Meaning |
| --- | --- |
| available | Final secret-bearing target can be handed directly to proxy |
| placeholder | Named downloading/slots-full/rate-limit/other clip |
| timeout | First-hop timeout may have initiated a remote add |
| rate_limited | First response HTTP 429 |
| failed | Unusable first response or exhausted redirect chain |

An inconclusive later hop can defer final judgment to the source proxy instead of rejecting an otherwise resolved link. Debug logs record redirect shape only, not the target URL (`apps/server/src/gateway/client.ts`).

[Downloads](../features/downloads.md) interprets downloading/timeouts as tracking handoff; ordinary playback resolution maps placeholders to errors. Probing an uncached link can trigger a remote TorBox add, so it is not a harmless metadata lookup.

## Modification entry points

Change discovery parsing/sharing in `apps/server/src/gateway/client.ts`, redirect/body-size classification in `apps/server/src/gateway/playbackProbe.ts`, and clip semantics in `apps/server/src/playback/placeholder.ts`. Preserve the single shared limiter and server-only targets. See [selection](../features/stream-selection.md) and [proxy](source-proxy.md).

## Key source files

| File | Purpose |
| --- | --- |
| `apps/server/src/gateway/client.ts` | Discovery and probe facade |
| `apps/server/src/gateway/playbackProbe.ts` | Redirect/size checks |
| `apps/server/src/gateway/cache.ts` | Persistent TTL and reverse IDs |
| `apps/server/src/gateway/rateLimiter.ts` | Dispatch queue |
| `apps/server/src/gateway/types.ts` | Identities and wire types |
| `apps/server/src/playback/placeholder.ts` | Clip/error rules |

## Measured scope

At `5eefa37`, scoped `git ls-files` counts **5 gateway `.ts` source / 2 matching `*.test.ts` files**, ratio **0.40**, using only `apps/server/src/gateway/` and `apps/server/test/gateway/`. Integration/download/live tests and helpers are excluded. Default-branch history/CODEOWNERS identify **1 unique human author**, excluding bots. No gateway requests were made for documentation.
