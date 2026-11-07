# Player

Active contributors: VeroxAUS

The full-window HLS player starts or attaches to a server session, drives a video element and owns progress, cleanup, controls and track selection. `PlayerPage` in `apps/web/src/pages/PlayerPage.tsx` is the route controller; `Playback` in `apps/web/src/player/Playback.tsx` renders the ready session; `usePlaybackModel` in `apps/web/src/player/usePlaybackModel.ts` composes the hooks. Server encoding and selection are covered in [playback](../../systems/playback/index.md).

## Routes and session startup

`parsePlayTarget` in `apps/web/src/player/target.ts` accepts `/play/movie/:id` or `/play/tv/:id/:season/:episode`, rejects malformed/extra segments and permits season zero for Specials. `?start=` accepts 1–6 decimal digits as seconds. Details actions supply floored saved seconds for Resume or explicit zero for Start over; the player does not independently fetch saved progress to choose a starting position.

`useSessionStart` in `apps/web/src/player/useSessionStart.ts` exposes loading, ready, downloading or error. A microtask avoids duplicate development-remount POSTs. If a session arrives after navigation away, it is stopped immediately.

`startSession` in `apps/web/src/player/sessionApi.ts` sends `POST /api/sessions` with title fields, capability profile, **`streamId: "auto"`**, optional `startPositionSec` and **no subtitle field**. The server applies its default-subtitle policy.

| Answer | Client behavior |
| --- | --- |
| **201 session** | Validate session, mount playback using the server's playlist URL and reported start position |
| **202 download tracking** | Validate download, update/invalidate details via `apps/web/src/player/downloading.ts`, show “Downloading, try again later,” return to details without opening HLS |
| Error | Show message/hint, Retry, Back to details and Health-dashboard access |

Retry after a startup failure starts another attempt. Retry after a fatal playing-stream failure first snapshots the current position and ends the old session. `waitForStop` in `apps/web/src/player/sessionApi.ts` waits for that shutdown promise or **4 seconds**, then permits replacement, preventing a race against the old encoder slot. Retry clicks are deduplicated while draining. An attached desktop session has a separate give-up path that also drains a failed attachment before normal startup; see [desktop integration](desktop-integration.md#session-handoff-and-retry).

## HLS and playback state

The route is lazy in `apps/web/src/App.tsx`; `useHls` in `apps/web/src/player/useHls.ts` imports hls.js inside that player dependency graph, not Home's initial code. The player chunk has its own **210 kB gzip** budget.

When MediaSource-based hls.js is supported, the hook creates an instance, attaches video, loads the master playlist and attempts play after manifest parsing. It retains **60 seconds** of back buffer. Fragment policy uses **20-second** first-byte and **120-second** load limits, four timeout retries and up to **90** error retries at approximately 1-second intervals, accommodating subtitle extraction's temporary 503s. Fatal media errors get **two** recovery attempts; later fatal errors produce a user-facing failure card. Nonfatal errors remain with hls.js.

When hls.js is unsupported but the video element accepts `application/vnd.apple.mpegurl`, the hook loads HLS natively and seeks after metadata. With neither path, it reports unsupported HLS. The richer rendition-selection path is hls.js-specific; this fallback is not a claim of identical native track controls. Cleanup destroys the hls.js instance.

The video-state hook, reload flag and pending track PATCH determine buffering UI. Busy overlays use **`pointer-events: none`** in `apps/web/src/player/PlayerOverlays.module.css`: Back, Play/Pause and Seek remain clickable while starting/buffering. Error cards retain interactive Retry/Back links and buttons. This distinction has real Chromium hit-testing coverage, not only jsdom assertions.

## Tracks and controls

`useTrackSwitching` in `apps/web/src/player/useTrackSwitching.ts` serializes track changes with a ref guard:

- Text/sidecar subtitles select hls.js renditions locally; server track indices map to rendition IDs in `apps/web/src/player/tracks.ts`.
- Burn-in subtitles PATCH the session, then reload the **same playlist** at the current video position.
- Leaving burn-in sends **`subtitle: null`**, then applies the requested local text track or Off.
- Audio changes PATCH `audioIndex`, update the described session and reload at the current position.
- Selection is kept in a shared ref and reapplied when renditions are relisted. Off and burned-in tracks disable sidecar display. Subtitle toggle restores the last choice or first text track.
- A refused PATCH leaves playback available and displays a persistent error toast.

`usePlayerActions` in `apps/web/src/player/usePlayerActions.ts` centralizes buttons, keyboard and media-key behavior. Seek clamps to the title duration; skip is **−10/+30 seconds**, volume step **0.05**, and fullscreen targets the player stage. `useShortcuts` in `apps/web/src/player/useShortcuts.ts` listens even when chrome is hidden:

| Keys | Action |
| --- | --- |
| Space / K | Play/pause |
| Left / Right | Skip −10/+30 seconds |
| Up / Down | Volume ±0.05 |
| M / F / C / I | Mute / fullscreen / subtitles / info |
| P | Desktop pop-out or mini-player expand; ignored in a browser |
| Escape | Close menu, close info, exit fullscreen, then leave |

Text-entry targets and Ctrl/Alt/Meta combinations are ignored; toggle keys do not repeat. Space key-up is consumed to avoid also clicking a focused button. Chrome hides after **3 seconds** of inactivity, stays visible when paused/buffering or menus/info/track changes require it, and returns on input.

`InfoPanel` in `apps/web/src/player/InfoPanel.tsx` reports source/output decisions, tone mapping, tracks and encoder statistics; it refreshes session information only while open. `outputSummary` in `apps/web/src/player/decisionText.ts` distinguishes **1440p** rather than labeling it 1080p. Media Session metadata/actions are implemented in `apps/web/src/player/useMediaSession.ts`; snapshots for shell handoff live in `apps/web/src/player/snapshot.ts`.

## Progress and cleanup

`useProgressPings` and `useSessionEnd` in `apps/web/src/player/useSessionLifetime.ts` enforce ownership:

1. Wait for video metadata before storing/sending a position, so a not-yet-started resume cannot overwrite saved progress with zero.
2. Send position/state every **10 seconds**, including while **paused**, plus pause/seek events. Paused sessions otherwise make no segment requests and could hit the server's inactivity timeout.
3. On normal exit, send final known position with paused state, invalidate Home and all progress queries, then issue bodyless, content-type-free DELETE.
4. On non-persisted `pagehide`, beacon final progress and issue keepalive DELETE. A page entering back/forward cache is not ended.
5. Defer unmount cleanup by a zero-delay timer so StrictMode cleanup/setup does not terminate a live session; end at most once.
6. While a successful desktop handoff marks ownership released, skip final ping/DELETE because the other window now owns the session.

`invalidateWatchState` in `apps/web/src/player/watchState.ts` makes cached Continue Watching, Up next, Resume and Watched answers stale. The server owns completion/resumability rules; see [viewing progress](../../features/viewing-progress.md).

## Key source files

Preserve cleanup ordering, metadata gating and handoff release when changing hooks. Track changes must distinguish local sidecar selection from server encoder restart; avoid adding a manual source picker or a second session owner.

| File | Purpose |
| --- | --- |
| `apps/web/src/pages/PlayerPage.tsx` | Target, start/attach state and retry transitions |
| `apps/web/src/player/Playback.tsx` | Video, overlays and draining Retry |
| `apps/web/src/player/sessionApi.ts` | Start/PATCH/DELETE/progress/prefetch helpers |
| `apps/web/src/player/useHls.ts` | HLS instance, native fallback and recovery |
| `apps/web/src/player/useTrackSwitching.ts` | Audio/subtitle handoff |
| `apps/web/src/player/useSessionLifetime.ts` | Paused pings and exactly-once teardown |
| `apps/web/src/pages/PlayerPage.test.tsx` | Starts, progress, late results and fatal Retry |
| `apps/web/src/pages/PlayerControls.test.tsx` | Input, tracks, info and chrome |
| `apps/web/src/pages/PlayerExtras.test.tsx` | Pagehide, native fallback and PATCH failure |
| `apps/web/e2e/player-input.spec.ts` | Browser-intercepted layout hit-testing |

Measured committed scope: `src/player/` has **27 production files**, **3 tests**; adding the four dedicated `src/pages/Player*.test.tsx` suites gives **7/27 = 0.26** test-to-source file ratio. The route file itself is counted under pages, not this denominator. Unique human authors **1**; see [inventory method](index.md#measured-scope). Browser fixtures do not run a real encoder or prove media playback; see [test boundaries](build-and-tests.md#isolated-browser-flow).
