# Prefetch
Active contributors: VeroxAUS

Prefetch speculatively warms the source that an automatic playback session would choose. It resolves a link, warms source bytes and shares a probe result; it does not create a playback session, start an encoder, or generate HLS.

## Key abstractions

| Abstraction | Source | Role |
| --- | --- | --- |
| PrefetchService | `apps/server/src/prefetch/service.ts` | Merge runs, bounded stream-ID response, background warming |
| Route | `apps/server/src/routes/prefetch.ts` | Validate body and return HTTP 202 |
| Contracts | `packages/shared/src/playback.ts` | PrefetchRequest, nullable streamId response |
| Proxy ownership | `apps/server/src/sourceproxy/proxy.ts` | Shared source/probe, prefetch retention and eviction |
| Byte warming | `apps/server/src/sourceproxy/sourceEntry.ts` | Head/tail requests and source size discovery |
| Dedicated tests | `apps/server/test/prefetch/prefetch.test.ts` | Merging, reuse, validation, privacy and failure isolation |

## Request and background flow

1. `POST /api/prefetch` validates media identity and a full device profile; TV needs season and episode. Invalid bodies return 400.
2. Upsert the device with normalized client IP. Key the run by media key plus `deviceMaxRank`, so different devices in the same resolution tier share work.
3. Merge an in-progress run, or a successful run completed within 60 seconds. Failed/skipped runs are removed and can be retried.
4. Resolve TMDB details to IMDb; use `cachedList` when fresh, otherwise discover/rank streams normally.
5. Skip if there is no IMDb ID, recommendation, cached-on-TorBox marker, or still-resolvable stream.
6. Announce the chosen stream ID, acquire the raw URL with the proxy's `prefetch` owner and call its shared `probe()`.

The response waits at most **300 ms** for the chosen ID by default, returning `{streamId: null}` if the budget wins; background work continues. The budget is not an end-to-end warming deadline. A returned ID means selection happened, not that bytes/probe are ready or that warming will succeed.

## Retention and playback integration

The [source proxy](../systems/source-proxy.md) shares entries by raw gateway URL and merges concurrent acquisition. Remote creation starts up to **16 MiB of head** and **8 MiB of tail** reads in parallel and resolves acquisition once the size is known; reads continue in the background. Successful probes are shared with later consumers; a failed probe clears the cached promise and releases the prefetch handle.

Successful warming retains prefetch ownership rather than immediately releasing it. Defaults keep at most **3 prefetch-only sources** (oldest first eviction), with a **10-minute idle TTL** checked every **30 seconds**. An active session reference prevents prefetch-only eviction from dropping its source. These proxy limits are distinct from the service's 60-second duplicate merge window.

Playback can reuse the source and probe when it acquires the same URL. Prefetch does not reserve the selection: later cache changes or differing selection inputs can lead to a different source.

## Failure and modification

Background lookup/acquisition/probe failures become warning events; missing prerequisites become informational skips. Messages redact secrets and replace URL-shaped strings. Device/validation/database failures before the background run are not covered by the background catch. Event-recording failure is logged and does not fail the run. `idle()` waits for current runs for tests; `apps/server/src/app.ts` does not explicitly await it in its close hook.

Change orchestration/budget/merge policy in `apps/server/src/prefetch/service.ts`; change lifetime and warming byte policy in the proxy files above. Coordinate with [stream selection](stream-selection.md) and [playback](../systems/playback/index.md).

Measured subsystem: **1 source file** under `apps/server/src/prefetch/`, **1 dedicated test file** under `apps/server/test/prefetch/`, **1 unique committer** in scoped source history (`%cn <%ce>`). Counts use tracked `.ts` / `*.test.ts` and exclude route, contract, proxy and shared harness files. Tests were read, not executed.
