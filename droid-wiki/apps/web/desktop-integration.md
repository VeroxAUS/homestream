# Desktop integration

Active contributors: VeroxAUS

## Purpose

The web build is also the implemented Electron renderer. `desktopBridge` and `inMiniPlayer` in `apps/web/src/desktop/bridge.ts` detect the preload's `window.homestream` interface and return browser-safe fallbacks. The renderer never imports the desktop app; contracts come from `packages/shared/src/desktop.ts`. The [desktop shell](../desktop/index.md) owns windows, IPC authorization, tray, process supervision and native notifications.

## Setup, chrome and Settings

`useMissingKeys` in `apps/web/src/desktop/useMissingKeys.ts` enables its shared health query only when a desktop bridge exists, and separately gates interpretation of cached data on that bridge. Disabling a Query observer alone would still expose health cached by navigation. Without the bridge the hook returns `null`, so an ordinary browser keeps Home's normal content/loading/error UI and never gets the desktop setup screen or Open config control, even after the health pill has cached missing keys (`apps/web/src/desktop/Shell.test.tsx`). This does not make unconfigured server integrations work.

`configKeys` in `apps/web/src/desktop/configKeys.ts` extracts validated key-presence records from the config check, sorted TMDB, gateway, TorBox, then unknown keys. With the bridge, the first-run screen appears only for **missing required** records; optional TorBox absence alone does not block Home.

`FinishSetup` in `apps/web/src/desktop/FinishSetup.tsx` replaces Home, showing names and Set/Missing, **never secret values**. Open config delegates to the bridge. Check again requests a server restart, then makes up to **20** health checks with **1-second** waits, invalidating cached data once required keys are present. Restart refusal can display its message. The screen can also open the currently placeholder Health dashboard.

`DesktopSettings` in `apps/web/src/desktop/DesktopSettings.tsx` adds a Desktop card after This device on the **Settings** tab: Start with Windows, start minimized, close-to-tray versus quit, ready/failure notification switches, hardware acceleration, restart/status, logs and Quit. Persistence/status operations go through `apps/web/src/desktop/useDesktopSettings.ts`; changes are sent immediately, without a Save button, and status refreshes every **2 seconds** while mounted. Hardware acceleration takes effect after restart.

The separate **About** tab shows the desktop version and Electron 45, read-only server facts and a disabled Check for updates control because updates are not configured (`apps/web/src/pages/settings/AboutPanel.tsx`). A browser has no Desktop card or update control. The spoiler preference remains local in both runtimes; [Settings and spoilers](settings-and-spoilers.md) covers shared tabs and device controls. Panels stay mounted while hidden, so selecting About does not stop the Desktop status interval.

Navigation is an Electron drag region with interactive no-drag areas (`apps/web/src/components/Nav.module.css`). Player chrome clears native caption buttons outside fullscreen, including loading/error states; mini-player mode omits the main top bar.

## App shortcuts and unreachable banner

`AppKeys` in `apps/web/src/desktop/AppKeys.tsx` installs desktop-only window-level shortcuts. **?** opens/closes the shortcut sheet; Escape closes it. **Ctrl+F** or **/** focuses and selects the existing navigation search field **without navigating**; the first typed character then opens results. Search shortcuts are not offered in the player, where there is no navigation field. Slash/question-mark respect text entry, so a question mark typed into the field is text. The helper only focuses an already-rendered field; it does not expand a collapsed phone search control (`apps/web/src/lib/searchUrl.ts`). Zoom, F11, Alt+arrows and Alt+F4 belong to the shell. See [search](search.md) and [player keys](player.md#tracks-and-controls).

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

## Mini-player controls

`MiniControls` in `apps/web/src/desktop/MiniControls.tsx` provides compact play/pause, **−10/+30-second** skips, elapsed/duration labels, seek, always-on-top toggle, expand and close. Pop-out is available only in desktop main; P expands from mini. Closing mini first ends playback, then closes its window. Audio/subtitle/info buttons are not part of the compact controls.

`MiniVolume` in `apps/web/src/desktop/MiniVolume.tsx` adds an accessible mute button and Volume range at the end of the bottom row, styled by `apps/web/src/desktop/MiniControls.module.css`. The range is **0–1 in 0.01 steps**; while muted its displayed value is zero without discarding the video's actual volume. Moving it above zero unmutes. The mute label/icon also treats zero volume as silent; the action itself toggles the video's mute flag (`apps/web/src/player/usePlayerActions.ts`).

Both windows apply handed-over volume/mute and publish their current values in the next snapshot (`apps/web/src/desktop/useDesktopPlayback.ts`, `apps/web/src/player/usePlayerSnapshot.ts`). `apps/web/src/desktop/MiniVolume.test.tsx` covers controls, positive-volume unmute, and volume/mute in both handoff directions using a fake bridge.

`useReportPlaying` in `apps/web/src/desktop/useReportPlaying.ts` reports playing versus pause/end/unmount to support the shell's display-awake behavior, without keeping the display awake after navigation.

## Integration and modification points

Extend bridge types in [shared](../../packages/shared.md), implement IPC in the shell, and keep browser fallbacks explicit. Preserve the released flag and queued attach subscription; a simple window navigation that also deletes the session would break continuity. In-app download toasts remain in `apps/web/src/notices/`; Windows notification eligibility/delivery belongs to the shell.

## Key source files

| File                                            | Purpose                                             |
| ----------------------------------------------- | --------------------------------------------------- |
| `apps/web/src/desktop/bridge.ts`                | Desktop/mini detection                              |
| `apps/web/src/desktop/useMissingKeys.ts`        | Bridge-gated query and cached config interpretation |
| `apps/web/src/desktop/FinishSetup.tsx`          | Missing-key guidance and restart/check loop         |
| `apps/web/src/desktop/DesktopSettings.tsx`      | Renderer settings and About rows                    |
| `apps/web/src/desktop/AppKeys.tsx`              | Search shortcuts and shortcut sheet                 |
| `apps/web/src/desktop/useUnreachable.ts`        | Health/error-to-supervisor status view              |
| `apps/web/src/desktop/useDesktopPlayback.ts`    | Ownership transfer and rollback                     |
| `apps/web/src/desktop/useAttachedSession.ts`    | Existing-session attach, timeout and draining Retry |
| `apps/web/src/desktop/MiniControls.tsx`         | Mini-window controls                                |
| `apps/web/src/desktop/MiniVolume.tsx`           | Compact volume/mute using shared player actions     |
| `apps/web/src/desktop/Shell.test.tsx`           | Setup, shortcuts and unreachable rendering          |
| `apps/web/src/desktop/MiniPlayer.test.tsx`      | Handoff, attach/Retry and mini ownership tests      |
| `apps/web/src/desktop/MiniVolume.test.tsx`      | Mini volume/mute and bidirectional snapshot values  |
| `apps/web/src/desktop/DesktopSettings.test.tsx` | Settings bridge interactions                        |

Measured tracked `apps/web/src/desktop/` scope: **15 production files**, **4 tests**, **4/15 = 0.27** test-to-source file ratio; unique human authors **1**. See [inventory method](index.md#measured-scope). These renderer tests use a fake bridge, not a launched Electron application.
