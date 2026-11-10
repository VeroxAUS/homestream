# Windows and IPC

Active contributors: VeroxAUS

## Purpose and key abstractions

The desktop shell loads the ordinary web renderer with a narrow capability bridge, rather than enabling Node in pages. Playback ownership moves between windows without starting another server session. See [desktop overview](index.md) and the renderer-side [desktop integration](../web/desktop-integration.md).

| Boundary                                | Source                              | Role                                                           |
| --------------------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `createMainWindow` / `createMiniWindow` | `apps/desktop/src/shell/windows.ts` | Electron windows, preferences and navigation guards            |
| `MiniPlayerState`                       | `apps/desktop/src/miniPlayer.ts`    | One open mini player and one-shot pending handover             |
| `HomestreamBridge`                      | `packages/shared/src/desktop.ts`    | Typed renderer capability surface                              |
| `createHandlers` / `registerIpc`        | `apps/desktop/src/ipc.ts`           | Argument validation and trusted-frame URL checks               |
| Preload exposure                        | `apps/desktop/src/preload.cts`      | Named invocations exposed through context isolation            |
| `placeWindow`                           | `apps/desktop/src/windowBounds.ts`  | Correct observed main-window bounds, without a correction loop |
| `guardPermissions`                      | `apps/desktop/src/permissions.ts`   | Matching session permission request/check rules                |

## Main and mini windows

The main window defaults to **1360×840**, minimum **1024×640**. `apps/desktop/src/windowState.ts` validates persisted rectangles, restores a fully visible placement on an available display, and otherwise centers a fitted window on the primary display. Maximization is restored; fullscreen is not. Move/resize saves debounce for 500 ms, skip minimized/fullscreen states and flush on close (`apps/desktop/src/shell/windows.ts`).

Geometry uses Electron's device-independent pixels (DIP), not physical display pixels. Main state saves **normal window bounds**, not content dimensions. Before restoring maximization, `createMainWindow` calls `placeWindow`: set the desired bounds, read `getBounds()`, and, if different, apply one correction by the observed x/y/width/height delta. This avoids repeatedly saving native invisible-border inflation (the regression models 1300×820 growing to 1304×823). Only the deltas are logged. At most two `setBounds` calls occur; an OS that refuses exact placement is not retried indefinitely.

The main close button either hides to tray (leaving fullscreen first) or requests graceful quit, according to preferences. A successful first tray-close notice is remembered, so it is not shown every time.

The mini player is frameless, defaults to **480×270 content DIP**, minimum **320×180**, uses a 16:9 aspect lock, and starts bottom-right of the main window's display with a 16-DIP margin. It uses `useContentSize: true` and explicitly reapplies `setContentSize(480, 270)` **after** `setAspectRatio`, since the invisible resize border affects aspect-lock rounding. This content-size correction is distinct from main-window bounds persistence. It starts pinned above other windows; each new mini player resets that choice.

## Handoff protocol

`HandoverSchema` in `packages/shared/src/desktop.ts` carries session ID, playlist URL, position, pause/volume/mute state, selected audio/subtitle, title and validated movie/episode media key.

1. The main renderer supplies a handover. The shell accepts only one open mini player and builds a local player route with `attach=1&mini=1`, then hides main.
2. The recipient requests the pending handover. The main process retains it until claimed, so a late-loading page does not miss a transient event.
3. Returning checks that the session ID matches the mini player's held session, retains the updated handover for the main renderer, destroys mini and opens the non-mini attach route.
4. Closing mini clears its handover and sends main to title details.

The state machine itself starts or ends no playback session. The renderer performs player/session lifecycle work; do not equate destroying a window with deleting a server session. Native mini close delegates to the same shell close path, but explicit renderer cleanup and OS window destruction are distinct boundaries (`apps/desktop/src/shell/shell.ts`). Attach-mode and media cleanup behavior are documented in [desktop integration](../web/desktop-integration.md).

The pending handover is one shared one-shot slot, not a queue or durable store. Current IPC claiming is not restricted by sender ID; the shell relies on its trusted page set rather than implementing per-window authorization.

Volume and mute belong to the renderer's player state and travel in the existing handover. The new mini-player slider does not add a bridge method or start another session (`apps/web/src/desktop/MiniVolume.tsx`, `packages/shared/src/desktop.ts`). Native window placement and always-on-top behavior remain main-process responsibilities.

## IPC and origin trust

The sandboxed preload exposes exactly **20 members**: three markers/version fields and 17 methods (`apps/desktop/src/preload.cts`). There is no generic send/invoke channel or arbitrary filesystem/network API.

The named-channel allowlist in `apps/desktop/src/ipc.ts` covers startup preferences, restart/retry/quit, status and diagnostics, fixed logs/config actions, desktop settings, local playback reports and mini controls. Boolean arguments are checked explicitly; handovers use the shared schema; settings updates validate their discriminated key/value pair in `apps/desktop/src/settings.ts`. The shell-only close-notice field cannot be set by the renderer.

Each invocation checks the **sending frame's URL**. Trusted URLs are the exact loopback server origin and its slash-prefixed paths, or the exact bundled startup page with query/hash variants. Prefix lookalikes on a different origin are not accepted. This is URL-based trust, not proof of top-frame ownership or authentication; same-origin frames are not separately excluded. It must remain aligned with server exposure/security assumptions.

Both window types use context isolation, sandboxing, disabled Node integration and disabled background throttling (`apps/desktop/src/shell/windows.ts`). In-window navigation outside trusted URLs is prevented. New-window requests are always denied; HTTPS links may open in the system browser, other schemes do not.

### Shared-session permissions and Escape

`Shell.start()` calls `guardPermissions(session.defaultSession, client.origin)` before creating windows (`apps/desktop/src/shell/shell.ts`). Neither window selects a separate session/partition, so this is a **shared-session** policy, not one independently installed per window or scoped by web-contents ID.

| Permission      | Request/check decision                                                                       |
| --------------- | -------------------------------------------------------------------------------------------- |
| `fullscreen`    | Allowed as before, even without a requester URL                                              |
| `keyboardLock`  | Allowed only when the parsed requester URL has exactly the configured loopback server origin |
| Everything else | Denied, including media, notifications, geolocation, pointer lock and clipboard read         |

`apps/desktop/src/permissions.ts` installs both `setPermissionRequestHandler` and `setPermissionCheckHandler`, because Chromium may use either. Requests use `details.requestingUrl`; checks prefer that URL and fall back to `requestingOrigin` only when it is absent. The startup file page, malformed/missing URLs, different ports and prefix-lookalike hosts cannot acquire keyboard lock. This is origin-based permission policy, not per-frame/device authorization. There is **no separate `setDevicePermissionHandler` or device-selection handler installed** in this shell; do not infer such coverage from the generic request/check denial rule. See [security](../../security.md).

The renderer's `useFullscreen` in `apps/web/src/player/usePlayerActions.ts` locks `['Escape']` while its stage is fullscreen and unlocks when fullscreen ends or the hook unmounts; unmount also attempts to leave that stage's fullscreen. `usePlaybackModel` in `apps/web/src/player/usePlaybackModel.ts` orders Escape as **close menu → close Info → leave fullscreen → leave player**. Origin-scoped keyboard lock lets those first steps run before Chromium consumes Escape to leave fullscreen. Unsupported/refused locks degrade quietly; this permission change does not add an IPC method or native global shortcut.

`apps/desktop/src/shell/appMenu.ts` installs focused-window zoom, fullscreen and history accelerators without global shortcuts. It hides the application menu bar; startup history is cleared after entering the web UI.

## Keep awake and notifications

`KeepAwake` in `apps/desktop/src/keepAwake.ts` holds at most one blocker:

| Input                                            | Mode                   |
| ------------------------------------------------ | ---------------------- |
| Any local renderer actively playing              | Prevent display sleep  |
| No local playback, but any active server session | Prevent app suspension |
| Neither                                          | None                   |

`apps/desktop/src/shell/shell.ts` tracks local playback per web-contents ID, clearing it on main-frame document navigation and window close. Paused/remote sessions can retain only the weaker server-session mode. Errored/stopped sessions are excluded by [monitoring](supervisor.md).

Pure toast planning lives in `apps/desktop/src/notifications.ts`: ready notifications respect their switch even while focused; failure notifications require their switch and no focused main/mini window. Title text is control-cleaned, bounded and XML-escaped. Actions open title details or health; toast activation tokens are fixed words, not server-provided URLs. `ToastCenter` in `apps/desktop/src/shell/toasts.ts` retains Electron notification references until close/failure and skips unsupported platforms. A planned tag is not itself an implemented replacement/deduplication mechanism in this adapter.

## Modification entry points and tests

Change bridge shape in shared, update both the IPC allowlist and preload channel table, and update renderer callers together. Keep handoff/session cleanup in the appropriate layer rather than adding media side effects to the pure handoff state machine.

`apps/desktop/test/ipc.test.ts` checks handlers, hostile origins, invalid inputs and preload channel consistency. `apps/desktop/test/miniPlayer.test.ts` exercises routing, one-session handoff and power transitions; `apps/desktop/test/windowState.test.ts` checks display recovery; `apps/desktop/test/notifications.test.ts` covers focus policy, title safety and XML. `apps/desktop/test/windowBounds.test.ts` models exact placement, 4×3 border inflation, shifted coordinates and a stubborn window capped at two writes. `apps/desktop/test/permissions.test.ts` captures both session handlers and checks URL precedence/fallback, server-origin keyboard lock, fullscreen and other-permission denials. These tests do not launch Electron.

Renderer ordering/cleanup regressions live in `apps/web/src/pages/PlayerControls.test.tsx` and `apps/web/src/player/hooks.test.tsx`; refused-lock/fullscreen cleanup is covered in `apps/web/src/pages/PlayerFailures.test.tsx`. They test renderer policy with stubs, not native OS key delivery or real display scaling. Change geometry policy in `apps/desktop/src/windowBounds.ts` / `apps/desktop/src/windowState.ts`, session permission policy in `apps/desktop/src/permissions.ts`, and their Electron application in `apps/desktop/src/shell/windows.ts` / `apps/desktop/src/shell/shell.ts`.

The separate first-run smoke checks the real preload's exact 20-member surface, desktop/non-mini markers, visible window/tray and settings persistence (`apps/desktop/test/smoke/launch.smoke.ts`). Its configured companion drives the real renderer over CDP until Home has a content mark, no setup screen, a Trending Movies heading and poster titles from the local stub (`apps/desktop/test/smoke/configured.smoke.ts`, `apps/desktop/test/smoke/harness.ts`). It does not exercise native mini playback handoff or prove media encoding. See [smoke scenarios and bounds](index.md#first-run-versus-configured-home) and [testing tiers](../../how-to-contribute/testing.md).

## Key source files

| File                                | Purpose                                   |
| ----------------------------------- | ----------------------------------------- |
| `apps/desktop/src/shell/windows.ts` | Window configuration and navigation       |
| `apps/desktop/src/windowState.ts`   | Geometry validation and persistence rules |
| `apps/desktop/src/windowBounds.ts`  | Observed border/position correction       |
| `apps/desktop/src/permissions.ts`   | Shared-session request/check policy       |
| `apps/desktop/src/miniPlayer.ts`    | Handoff state and attach routes           |
| `apps/desktop/src/ipc.ts`           | Trusted URLs and validated named handlers |
| `apps/desktop/src/preload.cts`      | Sandboxed capability exposure             |
| `packages/shared/src/desktop.ts`    | Bridge, handover and diagnostic contracts |
| `apps/desktop/src/keepAwake.ts`     | Pure power-blocker policy                 |
| `apps/desktop/src/notifications.ts` | Notification planning and escaping        |

## Measured scope

Desktop-wide committed inventory at `663492c`: **33 source / 21 test files** (19 `.test.ts`, two `.smoke.ts`; three helpers excluded), ratio **0.64**, **1 unique human author** from `origin/main` excluding bots, VeroxAUS. See the [overview](index.md#measured-scope) for the committed-path count method; these are app-wide counts, not coverage.
