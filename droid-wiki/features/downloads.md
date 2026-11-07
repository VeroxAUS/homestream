# Downloads

Active contributors: VeroxAUS

## Purpose

Downloads persist tracking of remote TorBox caching, not complete media files downloaded to the PC. `DownloadService` in `apps/server/src/downloads/service.ts` asks the gateway to initiate uncached playback and polls until the title is actually listed as cached.

## Start handoff and layout

`SessionStarter` in `apps/server/src/playback/sessionStart.ts` reuses existing automatic tracking before session reservation/metadata work. Otherwise no cached source means one uncached recommendation enters download handling.

`DownloadService.begin` in `apps/server/src/downloads/service.ts` deduplicates concurrent starts by media key. It resolves the stream and calls the [gateway probe](../systems/gateway.md), following/checking redirects and implausible body sizes. A playable result carries its resolved target internally to the proxy and creates no tracking row.

| Probe result | Outcome |
| --- | --- |
| downloading clip | Persist tracking; **202** download response |
| first-hop timeout | Assume the add may have started; persist tracking |
| playable media | Continue normal session creation |
| slots-full clip | 409 |
| rate limit | 429 |
| other failure | 502 |

202 contains no session or playlist. Ready tracking does not automatically start video; the client must Play again. Tracking persists no media URL (`apps/server/src/downloads/store.ts`).

`TorboxClient` in `apps/server/src/downloads/torbox.ts` is a read-only list client. The gateway initiates the remote add; HomeStream does not upload media or manage remote job deletion.

## Persistent lifecycle and ready rule

```mermaid
graph LR
    Pending[Pending tracking] --> Downloading
    Downloading -->|TorBox finished and files present| Confirm[Confirm gateway list]
    Pending -->|Cached listing| Ready
    Downloading -->|Cached listing| Ready
    Confirm -->|Cached listing only| Ready
    Confirm -->|Still absent| Waiting[Continue pending checks]
    Waiting --> Confirm
    Waiting -->|24-hour age| Failed
    Pending -->|Cancel tracking| Removed
```

**A cached gateway stream is required for ready.** TorBox completion alone sets progress to one and begins confirmation, not ready (`apps/server/src/downloads/service.ts`). Confirmation retries every **two minutes** initially. After **ten minutes** it slows to the **five-minute** gateway cadence; it does not trust completion and mark ready on timeout. The overall **24-hour** give-up still applies.

One TorBox list serves due hash-trackable rows, matching primary or alternative hashes. Missing API key/hash, auth refusal or absent items fall back to fresh gateway checks. Cancellation is rechecked after asynchronous list work.

`apps/server/src/downloads/rules.ts` defines one-minute polls for the first hour, five minutes afterwards; transient backoff doubles up to ten minutes. Failed TorBox states terminate tracking. Stalled/no-progress state terminates after six hours. Progress is nondecreasing and events emit on movement at most once per minute.

`apps/server/src/downloads/store.ts` persists identity, scheduling, progress and notification data. Startup resumes pending tracking and prunes old finished rows.

## API and events

`apps/server/src/routes/downloads.ts` lists retained rows and deletes local tracking. **Cancel does not cancel the remote TorBox job.** Movie/show details expose pending entries through `apps/server/src/routes/catalog.ts`.

Events are download.started/progress/ready/failed. Ready rows completed without SSE listeners keep an unnotified marker for later replay; this is not a durable per-client acknowledgement system (`apps/server/src/downloads/service.ts`, `apps/server/src/routes/events.ts`).

The implemented [web player](../apps/web/index.md) consumes the 201/202 distinction, while details can show pending state. Dashboard queue presentation remains separate. Source warm-up via [prefetch](prefetch.md) is not remote caching.

## Modification entry points

Change pure timing/verdicts in `apps/server/src/downloads/rules.ts`, orchestration in `apps/server/src/downloads/service.ts`, persistence in `apps/server/src/downloads/store.ts` and list transport in `apps/server/src/downloads/torbox.ts`. Preserve cached-only ready, title-key deduplication and cancellation boundaries.

## Key source files

| File | Purpose |
| --- | --- |
| `apps/server/src/downloads/service.ts` | Handoff, polling and confirmation |
| `apps/server/src/downloads/rules.ts` | Pure timing/verdicts |
| `apps/server/src/downloads/store.ts` | Persistent tracking |
| `apps/server/src/downloads/torbox.ts` | Read-only provider list |
| `apps/server/src/gateway/playbackProbe.ts` | Placeholder-safe probe |
| `apps/server/src/routes/downloads.ts` | Local tracking API |

## Measured scope

At `5eefa37`, scoped `git ls-files` counts **4 downloads `.ts` source / 2 matching `*.test.ts` files**, ratio **0.50**. Integration, routes, DB/contracts/web and helpers are excluded. Default-branch history/CODEOWNERS identify **1 unique human author**, excluding bots. No TorBox/gateway requests were made.
