# Windows and IPC

Active contributors: VeroxAUS

## Purpose and key abstractions

The desktop shell loads the ordinary web renderer with a narrow capability bridge, rather than enabling Node in pages. Playback ownership moves between windows without starting another server session. See [desktop overview](index.md) and the renderer-side [desktop integration](../web/desktop-integration.md).

| Boundary                                | Source                              | Role                                                |
| --------------------------------------- | ----------------------------------- | --------------------------------------------------- |
| `createMainWindow` / `createMiniWindow` | `apps/desktop/src/shell/windows.ts` | Electron windows, preferences and navigation guards |
| `MiniPlayerState`                       | `apps/desktop/src/miniPlayer.ts`    | One open mini player and one-shot pending handover  |
| `HomestreamBridge`                      | `packages/shared/src/desktop.ts`    | Typed renderer capability surface                   |
| `createHandlers` / `registerIpc`        | `apps/desktop/src/ipc.ts`           | Argument validation and trusted-frame URL checks    |
| Preload exposure                        | `apps/desktop/src/preload.cts`      | Named invocations exposed through context isolation |

## Main and mini windows

The main window defaults to **1360×840**, minimum **1024×640**. `apps/desktop/src/windowState.ts` validates persisted rectangles, restores a fully visible placement on an available display, and otherwise centers a fitted window on the primary display. Maximization is restored; fullscreen is not. Move/resize saves debounce for 500 ms, skip minimized/fullscreen states and flush on close (`apps/desktop/src/shell/windows.ts`).

The main close button either hides to tray (leaving fullscreen first) or requests graceful quit, according to preferences. A successful first tray-close notice is remembered, so it is not shown every time.

The mini player is frameless, defaults to **480×270**, minimum **320×180**, uses a 16:9 aspect lock, and starts bottom-right of the main window's display with a 16-pixel margin. It starts pinned above other windows; each new mini player resets that choice.

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

Both window types use context isolation, sandboxing, disabled Node integration and disabled background throttling (`apps/desktop/src/shell/windows.ts`). In-window navigation outside trusted URLs is prevented. New-window requests are always denied; HTTPS links may open in the system browser, other schemes do not. The default Electron session grants only fullscreen permission (`apps/desktop/src/shell/shell.ts`).

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

`apps/desktop/test/ipc.test.ts` checks handlers, hostile origins, invalid inputs and preload channel consistency. `apps/desktop/test/miniPlayer.test.ts` exercises routing, one-session handoff and power transitions; `apps/desktop/test/windowState.test.ts` checks display recovery; `apps/desktop/test/notifications.test.ts` covers focus policy, title safety and XML. These tests do not launch Electron.

The separate first-run smoke checks the real preload's exact 20-member surface, desktop/non-mini markers, visible window/tray and settings persistence (`apps/desktop/test/smoke/launch.smoke.ts`). Its configured companion drives the real renderer over CDP until Home has a content mark, no setup screen, a Trending Movies heading and poster titles from the local stub (`apps/desktop/test/smoke/configured.smoke.ts`, `apps/desktop/test/smoke/harness.ts`). It does not exercise native mini playback handoff or prove media encoding. See [smoke scenarios and bounds](index.md#first-run-versus-configured-home) and [testing tiers](../../how-to-contribute/testing.md).

## Key source files

| File                                | Purpose                                   |
| ----------------------------------- | ----------------------------------------- |
| `apps/desktop/src/shell/windows.ts` | Window configuration and navigation       |
| `apps/desktop/src/windowState.ts`   | Geometry validation and persistence rules |
| `apps/desktop/src/miniPlayer.ts`    | Handoff state and attach routes           |
| `apps/desktop/src/ipc.ts`           | Trusted URLs and validated named handlers |
| `apps/desktop/src/preload.cts`      | Sandboxed capability exposure             |
| `packages/shared/src/desktop.ts`    | Bridge, handover and diagnostic contracts |
| `apps/desktop/src/keepAwake.ts`     | Pure power-blocker policy                 |
| `apps/desktop/src/notifications.ts` | Notification planning and escaping        |

## Measured scope

Desktop-wide committed inventory at `bb09d63`: **31 source / 19 test files** (17 `.test.ts`, two `.smoke.ts`; three helpers excluded), ratio **0.61**, **1 unique human author** from `origin/main` excluding bots, VeroxAUS. See the [overview](index.md#measured-scope) for the committed-path count method; these are app-wide counts, not coverage.
