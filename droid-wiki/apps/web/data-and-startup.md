# Data and startup

Active contributors: VeroxAUS

## Purpose

The client separates TanStack Query server data, route/component state, persistent device identity and small external stores for downloads, event-stream liveness and notices. Request code lives in `apps/web/src/api/`; SSE lives in `apps/web/src/events/`. There is no separate monolithic application-state store.

## Requests and cache keys

`apiFetch` in `apps/web/src/api/client.ts` preserves request options, adds a UUID `X-Request-ID`, logs through the structured wrapper and throws `ApiError` for non-2xx answers. Errors carry status, code, message, optional hint and request ID. `apiGet` validates JSON against a [shared schema](../../packages/shared.md).

`createQueryClient` and query factories in `apps/web/src/api/queries.ts` define:

| Setting                               | Value                                                             |
| ------------------------------------- | ----------------------------------------------------------------- |
| Query GET deadline                    | **15 seconds**, combined with Query cancellation                  |
| Retry                                 | One retry after **800 ms** for non-`ApiError`, non-timeout errors |
| Window-focus refetch                  | Disabled                                                          |
| Default stale / unused cache lifetime | **5 / 10 minutes**                                                |
| Home stale time                       | **30 seconds**                                                    |
| Health stale time                     | **30 seconds**                                                    |
| Health fallback polling               | **60 seconds**, foreground only, disabled while SSE is live       |
| Saved progress                        | Immediately stale; always refetch on mount                        |

The deadline/retry behavior is attached to query fetchers, **not every raw `apiFetch` mutation**. Session starts, patches and progress use their own lifetime rules.

Keys are `['home']`, `['health']`, `['info']`, `['search', text]`, `['movie', id]`, `['show', id]`, `['season', id, season]`, `['progress', 'movie', id]` and `['progress', 'tv', id]`. Movie-progress 404 maps to `null`; other errors propagate. Screen actions treat failed progress as absent. Playback cleanup invalidates both Home and the progress prefix after its final ping (`apps/web/src/player/watchState.ts`).

Search's current text and immediate-submit marker belong to routing, not a second shared store. `apps/web/src/components/useNavSearch.ts` synchronizes the field with raw URL text; `apps/web/src/pages/SearchPage.tsx` queries the trimmed, settled value. Query cancellation and per-text keys prevent late answers from becoming the current results. See [navigation search](search.md).

The spoiler preference is a separate `useSyncExternalStore` over browser storage, with same-page notifications, cross-window storage listeners and blocked-storage fallback. It never belongs to the server's device capability record or triggers an API mutation (`apps/web/src/lib/spoilers.ts`). [Settings and spoilers](settings-and-spoilers.md) explains its rendering policy.

## Deferred startup

`apps/web/src/main.tsx` prefetches Home concurrently with its lazy route only when the initial pathname is `/`. Registration, SSE and optional telemetry are scheduled independently, not awaited before mounting React. Health and visible-page queries may start immediately.

`markContentShown`, `afterHomeContent` and `whenIdle` in `apps/web/src/lib/startup.ts` implement the gate:

1. A ready screen calls `useContentShown` from `apps/web/src/lib/useContentShown.ts`.
2. On the next animation frame, mark **`hs:home-content`** once.
3. Await that mark, or an **8-second** fallback timeout.
4. Await `requestIdleCallback` with a **3-second** timeout, or a zero-delay timer.
5. Open the event stream, register the device and load configured telemetry independently.

These are scheduling budgets, not guaranteed startup duration. The Home setup/error states also allow content readiness; a direct player route without a mark can use the timeout fallback.

`apps/web/src/telemetry/index.ts` imports no SDK at startup. Only a configured, non-opted-out build imports the runtime after this gate. Keys come from build-time environment/`.env` in `apps/web/src/telemetry/buildEnv.ts` and `apps/web/vite.config.ts`, never a runtime keys endpoint. Test mode and build-time telemetry-off set the embedded Sentry DSN, PostHog key and PostHog host to `null`, even when the build environment supplies values. No-key builds make no telemetry request. Browser storage opt-out disables telemetry at runtime; it does not rebuild or strip an already-built asset. See [build environment policy](build-and-tests.md#build-environment) and [telemetry](../../systems/telemetry.md). The content/idle gate is unchanged.

## Health reconciliation

`startServerEvents` in `apps/web/src/events/serverEvents.ts` owns one native `EventSource('/api/events')`. `useEventStreamLive` exposes whether it is open; health consumers pass the inverse to the health query's polling option. SSE does not send a baseline, and unchanged health sends no new event, so opening the stream must reconcile a snapshot.

The latest answer wins through Query ownership rather than an independent fetch:

- **Every open:** increment the health generation, cancel the in-flight health query and `fetchQuery` a zero-stale-time snapshot through `healthQuery(false)`. This replaces an older poll or snapshot, maintaining one pending Query request.
- **Pushed health:** validate the shared schema, advance the generation, cancel any older request and set `['health']`. A late old success or failure cannot replace that pushed answer or mark it failed.
- **Snapshot failure:** invalidate health only if its generation is still current; an obsolete snapshot must not invalidate a newer pushed answer.
- **Stream error:** mark it non-live and invalidate health when transitioning from live, so foreground polling resumes and notices an unreachable server.
- **Reopen after error:** reconcile health as above, then invalidate **non-health** queries to repair missed state after a restart. Excluding health avoids starting another competing refetch.

Health updates are global, not restricted to dashboard paths. Missing EventSource leaves query-based browsing operational. Native SSE reconnects itself; this connection is not an `apiFetch` with a custom UUID header.

## Download events and device identity

Download progress validates the event then updates `downloadKey` entries in `apps/web/src/events/downloadProgress.ts`: `movie:<id>` or `tv:<id>:<season>:<episode>`. The Map uses `useSyncExternalStore` and avoids notifications for unchanged fractions. `usePendingDownload` in `apps/web/src/events/usePendingDownload.ts` requires pending metadata, preferring live fractions over the snapshot. An event alone does not invent pending status.

Ready/failed events clear the fraction, invalidate matching movie/show details and notify subscribers for [toasts](screens.md#notifications-and-toasts). Malformed JSON/schema-invalid events are ignored. There is no download polling loop here.

`apps/web/src/device/identity.ts` stores `homestream.deviceId` and `homestream.deviceName`; blocked storage still permits page-lifetime identity. Names trim to **128 characters**, with an empty value returning to the default. The profile is H.264, SDR, up to **3840×2160**, stereo, no HEVC/Main10/HDR10. The preload selects desktop kind/name; otherwise the name defaults to Web browser. Registration failures never block UI. Device-name Save explicitly registers after its local write; this is separate from automatic deferred startup registration (`apps/web/src/pages/settings/DeviceCard.tsx`).

`randomUuid` in `apps/web/src/lib/uuid.ts` uses `crypto.randomUUID` when available, otherwise constructs an RFC 4122 v4 UUID from `crypto.getRandomValues`, setting version/variant bits. This is necessary for ordinary **HTTP LAN origins**, where `randomUUID` may be absent; both request IDs and device registration still work.

## Key source files

Centralize query keys/schema validation, preserve cancellation when changing health, and keep unrelated startup off the first-content path. Do not add separate snapshot fetches or blanket reconnect invalidation that races health reconciliation.

| File                                  | Purpose                                                |
| ------------------------------------- | ------------------------------------------------------ |
| `apps/web/src/api/client.ts`          | Request correlation, errors and parsing                |
| `apps/web/src/api/queries.ts`         | Timeouts, retries, keys and staleness                  |
| `apps/web/src/events/serverEvents.ts` | Singleton SSE and health ordering                      |
| `apps/web/src/events/events.test.tsx` | Late poll/snapshot, reconnect and download regressions |
| `apps/web/src/device/identity.ts`     | Persistent identity and capabilities                   |
| `apps/web/src/lib/uuid.ts`            | Secure random plain-HTTP fallback                      |
| `apps/web/src/lib/startup.ts`         | Content/idle gate                                      |
| `apps/web/src/lib/searchUrl.ts`       | Shared URL/search constants and focus marker           |
| `apps/web/src/lib/spoilers.ts`        | Reactive browser-local preference                      |
| `apps/web/src/telemetry/index.ts`     | Deferred SDK-free facade                               |
| `apps/web/src/telemetry/buildEnv.ts`  | Build-time telemetry configuration and key stripping   |

Measured tracked `apps/web/src/api/`, `apps/web/src/device/`, `apps/web/src/events/`, `apps/web/src/lib/` scope at `663492c`: **20 production files**, **9 tests**, **9/20 = 0.45** test-to-source file ratio; unique human authors **1**. See [inventory method](index.md#measured-scope).
