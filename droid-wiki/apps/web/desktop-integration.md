# Desktop integration

Active contributors: VeroxAUS

The web build is also the implemented Electron renderer. `desktopBridge` and `inMiniPlayer` in `apps/web/src/desktop/bridge.ts` detect the preload's `window.homestream` interface and return browser-safe fallbacks. The renderer never imports the desktop app; contracts come from `packages/shared/src/desktop.ts`. The [desktop shell](../desktop/index.md) owns windows, IPC authorization, tray, process supervision and native notifications.

## Setup, chrome and Settings

`useMissingKeys` in `apps/web/src/desktop/useMissingKeys.ts` reads the shared health query only when a desktop bridge exists. `configKeys` in `apps/web/src/desktop/configKeys.ts` extracts validated key-presence records from the config check, sorted TMDB, gateway, TorBox, then unknown keys. The first-run screen appears only for **missing required** records; optional TorBox absence alone does not block Home.

`FinishSetup` in `apps/web/src/desktop/FinishSetup.tsx` replaces Home, showing names and Set/Missing, **never secret values**. Open config delegates to the bridge. Check again requests a server restart, then makes up to **20** health checks with **1-second** waits, invalidating cached data once required keys are present. Restart refusal can display its message. The screen can also open the currently placeholder Health dashboard.

`DesktopSettings` in `apps/web/src/desktop/DesktopSettings.tsx` adds Start with Windows, start minimized, close-to-tray versus quit, ready/failure notification switches, hardware acceleration, restart/status, logs and Quit. Persistence/status operations go through `apps/web/src/desktop/useDesktopSettings.ts`. Hardware acceleration takes effect after restart. About shows the desktop version and Electron 45; Check for updates is disabled because updates are not configured. Browser Settings remains device naming and server facts.

Navigation is an Electron drag region with interactive no-drag areas (`apps/web/src/components/Nav.module.css`). Player chrome clears native caption buttons outside fullscreen, including loading/error states; mini-player mode omits the main top bar.

## App shortcuts and unreachable banner

`AppKeys` in `apps/web/src/desktop/AppKeys.tsx` installs desktop-only window-level shortcuts. **?** opens/closes the shortcut sheet; Escape closes it. **Ctrl+F** or **/** navigates to/focuses Search, except in the player, where navigation would end playback. Slash/question-mark respect text entry. Zoom, F11, Alt+arrows and Alt+F4 belong to the shell. Player keys are documented on [player](player.md#tracks-and-controls).

`UnreachableBanner` in `apps/web/src/desktop/UnreachableBanner.tsx` appears below navigation while the health query fails. `useUnreachable` in `apps/web/src/desktop/useUnreachable.ts` asks bridge server status once per **second only while unreachable**, derives retry countdown/attempt limit from shared supervisor rules, and invalidates health when status becomes running. Retry now invokes restart; Open logs delegates to the shell. An unsuccessful restart can replace the detail text with an actionable message.

The banner uses the same SSE-aware health Query as the pill/setup. Health polling is disabled while the stream is live; snapshots and pushed health reconcile with cancellation as described in [data and startup](data-and-startup.md#health-reconciliation). Player routes omit this banner rather than overlaying shell recovery UI over video.

## Session handoff and Retry

`useDesktopPlayback` in `apps/web/src/desktop/useDesktopPlayback.ts` hands one existing session between main and mini windows; it does **not** start a second encoder.

1. Validate the current snapshot against the shared handover schema. It includes session/title target, position, pause state, volume/mute and selected tracks/subtitle.
2. Set the released ref **before** pausing the sender, then ask the bridge to open mini or return to main.
3. On success, the sender's unmount cleanup skips final progress/DELETE. On refusal/throw, restore ownership and resume if previously playing.
4. The receiving player route uses `?attach=1` only with a desktop bridge. `useAttachedSession` in `apps/web/src/desktop/useAttachedSession.ts` subscribes to the queued handover and GETs the existing session.
5. Override the session's starting position and subtitle with handover values. Local text-subtitle choice may differ from the server default, so preserving the handover choice matters.
6. Apply handed-over volume/mute and hold a previously paused session paused when automatic playback begins.

The handover wait is **3 seconds**; absent handover permits normal startup fallback and closes a waiting mini window. A mini-window attachment fetch failure asks the shell to close mini/show main details rather than starting a replacement in the small window.

Main-window attachment failure can Retry. It must stop the handed-over session before abandoning attach mode: `giveUp` exposes loading while draining and changes `gaveUp` only after DELETE completes or **4 seconds**. Normal session startup remains disabled until then, avoiding a full-slot 429. Retry retains the handed-over position if no newer video position exists. Fatal playback Retry similarly awaits the old player's end path. See [player lifecycle](player.md#routes-and-session-startup).

`MiniControls` in `apps/web/src/desktop/MiniControls.tsx` provides compact play/seek, always-on-top toggle, expand and close. Pop-out is available only in desktop main; P expands from mini. Closing mini first ends playback, then closes its window. `useReportPlaying` in `apps/web/src/desktop/useReportPlaying.ts` reports playing versus pause/end/unmount to support the shell's display-awake behavior, without keeping the display awake after navigation.

## Integration and modification points

Extend bridge types in [shared](../../packages/shared.md), implement IPC in the shell, and keep browser fallbacks explicit. Preserve the released flag and queued attach subscription; a simple window navigation that also deletes the session would break continuity. In-app download toasts remain in `apps/web/src/notices/`; Windows notification eligibility/delivery belongs to the shell.

## Key source files

| File | Purpose |
| --- | --- |
| `apps/web/src/desktop/bridge.ts` | Desktop/mini detection |
| `apps/web/src/desktop/FinishSetup.tsx` | Missing-key guidance and restart/check loop |
| `apps/web/src/desktop/DesktopSettings.tsx` | Renderer settings and About rows |
| `apps/web/src/desktop/AppKeys.tsx` | Search shortcuts and shortcut sheet |
| `apps/web/src/desktop/useUnreachable.ts` | Health/error-to-supervisor status view |
| `apps/web/src/desktop/useDesktopPlayback.ts` | Ownership transfer and rollback |
| `apps/web/src/desktop/useAttachedSession.ts` | Existing-session attach, timeout and draining Retry |
| `apps/web/src/desktop/MiniControls.tsx` | Mini-window controls |
| `apps/web/src/desktop/Shell.test.tsx` | Setup, shortcuts and unreachable rendering |
| `apps/web/src/desktop/MiniPlayer.test.tsx` | Handoff, attach/Retry and mini ownership tests |
| `apps/web/src/desktop/DesktopSettings.test.tsx` | Settings bridge interactions |

Measured committed `src/desktop/` scope: **14 production files**, **3 tests**, **3/14 = 0.21** test-to-source file ratio; unique human authors **1**. See [inventory method](index.md#measured-scope). These renderer tests use a fake bridge, not a launched Electron application.
