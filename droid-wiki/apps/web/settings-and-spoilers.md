# Settings and spoilers

Active contributors: VeroxAUS

## Purpose

Settings separates device/shell controls from read-only About information. Episode spoiler protection is a default-on browser-local preference, not a server setting or progress mutation. Tabs and device controls live in `apps/web/src/pages/settings/`; the reactive preference lives in `apps/web/src/lib/spoilers.ts`.

## Layout and tab state

`apps/web/src/pages/SettingsPage.tsx` renders exactly two tabs and keeps **both panels mounted**, hiding the inactive one with the HTML `hidden` attribute. This preserves the device-name draft and means About's info query and desktop status hooks can run even when their panel is hidden.

| Surface                | Contents and implementation                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Settings / This device | Device name, Save, local spoiler switch and save status (`apps/web/src/pages/settings/DeviceCard.tsx`)                                     |
| Settings / Desktop     | Shell-only startup, tray, notifications, acceleration, restart/logs/quit controls (`apps/web/src/desktop/DesktopSettings.tsx`)             |
| About header           | Web app or desktop version/Electron label; disabled update check only with a desktop bridge (`apps/web/src/pages/settings/AboutPanel.tsx`) |
| About summary          | Server, Network, Playback and This device fact groups (`apps/web/src/pages/settings/AboutPanel.tsx`)                                       |

`apps/web/src/pages/settings/useSettingsTab.ts` reads `window.location.hash` on the first render, so `/settings#about` does not first show Settings. Only `#about` selects About; empty or unknown hashes select Settings. Switching tabs uses `history.replaceState`, retaining router state without adding a history entry or reloading. Hash-change events resynchronize selection, and a router navigation back to bare `/settings` resets it.

`apps/web/src/pages/settings/SettingsTabs.tsx` links tab IDs, `aria-controls` and panel `aria-labelledby`. Only the selected tab is in the normal tab order. Left/Right select and focus with wraparound; Home/End select the first/last tab. Enter/Space use native button activation. Tab then moves into the visible panel rather than visiting the inactive tab.

About uses a two-column summary, collapsing to one at **700 px and below**; labels/values wrap rather than forcing horizontal scrolling (`apps/web/src/pages/settings/About.module.css`). This breakpoint is separate from navigation search's up-to-699 px phone mode.

## Device identity and About information

Save trims the name, limits it to **128 characters**, writes locally, then calls device registration. Accepted registration shows “Device name saved”; an unreachable server shows an explicit local-only message. Empty names remove the stored override and return to Web browser or HomeStream Desktop (`apps/web/src/pages/settings/DeviceCard.tsx`, `apps/web/src/device/identity.ts`). Device identity is not an account; see [data and startup](data-and-startup.md#download-events-and-device-identity).

About requests schema-validated server information through `infoQuery`. It shows name/version/port, this window's origin and LAN addresses, plus the fixed “aiostreams (redacted)” source label. The playback profile is derived from the same capability helper used for session starts: **H.264, SDR, up to 2160p, stereo**. No gateway URL or upstream key is rendered. Loading, failure/hint and Retry are distinct states (`apps/web/src/pages/settings/AboutPanel.tsx`, `apps/web/src/api/queries.ts`).

The source label is display text, not an editable gateway configuration. Update checking is not configured. Shell persistence, server status refresh and native behavior are covered in [desktop integration](desktop-integration.md#setup-chrome-and-settings), not implemented by these tabs.

## Episode spoiler policy

`apps/web/src/lib/spoilers.ts` is the single store behind `useHideSpoilers`, `setHideSpoilers` and `isEpisodeHidden`.

| Rule                          | Current behavior                                                              |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Default                       | Hide spoilers unless the stored value is exactly `'off'`                      |
| Storage                       | `homestream.hideSpoilers`; enabling removes the key, disabling stores `'off'` |
| Same page                     | Notify subscribers immediately through `useSyncExternalStore`                 |
| Other windows sharing storage | Listen for that key's storage event or a storage-clear event                  |
| Blocked storage               | Keep the choice in module memory for the page lifetime                        |
| API writes                    | None; changing this preference does not register a device                     |
| Revealing an episode          | Only `completed === true` reveals it while protection is on                   |

Unknown, failed/not-loaded, untouched and resumable-but-incomplete progress all stay hidden. Completion policy itself remains server-owned; see [viewing progress](../../features/viewing-progress.md). This preference changes presentation, not metadata responses or playback authorization.

`apps/web/src/components/EpisodeRow.tsx` and `apps/web/src/components/EpisodePanel.tsx` request an unfinished episode's still at **w92** and draw it in the normal slot. They render `SPOILER_TEXT` instead of the real overview:

> Hidden to avoid spoilers. It appears once you've watched this episode.

The real overview is **not rendered into the DOM**, rather than visually concealed. This does not remove it from the API response. There is **no CSS blur/filter**; the soft image is a scaled-up low-resolution still. Completed episodes or an off preference use **w300** and real overview text. An episode with no still keeps its dimmed show backdrop at normal fallback size. Number, title, runtime, progress and actions remain available (`apps/web/src/components/EpisodeRow.tsx`, `apps/web/src/components/EpisodePanel.tsx`).

`apps/web/src/components/ContinueWatchingRow.tsx` applies the w92 rule to TV cards carrying a **w300 episode still**, including Up next. Those cards represent unfinished episodes. Movie images and generic show/movie backdrops retain their normal size; the card's title/episode label is not hidden. The implementation recognizes episode stills by the `/w300/` segment, so preserve that distinction if changing image contracts.

The toggle's help text calls the effect “Blurs stills,” but the implementation uses reduced image resolution. Do not add a CSS filter to match that wording; current tests explicitly check filter-free presentation (`apps/web/src/pages/settings/DeviceCard.tsx`, `apps/web/src/pages/ShowDetailsPage.spoilers.test.tsx`, `apps/web/e2e/spoilers.spec.ts`).

## Modification entry points and tests

Add a device-local preference to a small reactive store and `apps/web/src/pages/settings/DeviceCard.tsx`; do not silently extend the server capability profile. Edit tab selection in `apps/web/src/pages/settings/useSettingsTab.ts` and keyboard/ARIA relationships in `apps/web/src/pages/settings/SettingsTabs.tsx`. Change read-only facts in `apps/web/src/pages/settings/AboutPanel.tsx`. New API or IPC fields require [shared contracts](../../packages/shared.md).

`apps/web/src/pages/SettingsPage.test.tsx` covers hash startup/history, keyboard/ARIA, name saves, local-only failure and About content separation. `apps/web/src/lib/spoilers.test.ts` covers persistence/events/blocked storage; `apps/web/src/pages/ShowDetailsPage.spoilers.test.tsx` and `apps/web/src/components/ContinueWatchingRow.test.tsx` cover episode presentation.

`apps/web/e2e/settings-tabs.spec.ts`, `apps/web/e2e/settings-content.spec.ts` and `apps/web/e2e/spoilers.spec.ts` add browser layout, tab focus/history, bridge-double differences and seeded completion/Up-next cases. The tests do not launch Electron or play media; see [build and tests](build-and-tests.md#isolated-browser-flow).

## Key source files

| File                                              | Purpose                                    |
| ------------------------------------------------- | ------------------------------------------ |
| `apps/web/src/pages/SettingsPage.tsx`             | Persistent panel composition               |
| `apps/web/src/pages/settings/SettingsTabs.tsx`    | Accessible tab controls                    |
| `apps/web/src/pages/settings/useSettingsTab.ts`   | Initial hash and replacement history       |
| `apps/web/src/pages/settings/DeviceCard.tsx`      | Name save and local switch                 |
| `apps/web/src/pages/settings/AboutPanel.tsx`      | Read-only facts and application identity   |
| `apps/web/src/lib/spoilers.ts`                    | Preference persistence and completion gate |
| `apps/web/src/components/EpisodeRow.tsx`          | Spoiler-aware list entry                   |
| `apps/web/src/components/EpisodePanel.tsx`        | Spoiler-aware selected episode             |
| `apps/web/src/components/ContinueWatchingRow.tsx` | Episode-still handling on Home             |
| `apps/web/src/components/Toggle.tsx`              | Accessible controlled switch               |

The settings page, row wrapper and four TS/TSX files under `apps/web/src/pages/settings/` total **6 production files**, with **1 colocated page test file**, a **1/6 = 0.17** test-to-source file ratio for that narrow scope. Spoiler consumers, shared stores, desktop code and browser specs are outside that denominator. Unique human contributors: **1**. See the [web inventory](index.md#measured-scope) for the full application and counting method.
