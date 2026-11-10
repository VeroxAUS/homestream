# Screens

Active contributors: VeroxAUS

## Purpose

The web routes implement browsing, search, title details, playback and Settings. This page covers presentation and notices; [player](player.md) and [desktop integration](desktop-integration.md) explain session and shell behavior.

## Layout and routes

`App` in `apps/web/src/App.tsx` lazy-loads route components. `Layout` in `apps/web/src/components/Layout.tsx` provides navigation, route Suspense/error boundaries, shortcut handling and notices. Navigation and the unreachable banner are omitted on `/play` and `/play/*`; the player supplies its own top bar.

| Route                                               | Implemented behavior                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/`                                                 | Home rows, featured banner or desktop first-run setup                                |
| `/search?q=...`                                     | Results driven by the navigation field, with local type filters                      |
| `/movie/:id`                                        | Metadata, progress, download state, Play/Resume, cast and related titles             |
| `/tv/:id?season=...&episode=...`                    | Show details, season tabs, spoiler-aware episode rows/panel, cast and related titles |
| `/play/movie/:id`                                   | Real movie player, optional `?start=<seconds>`                                       |
| `/play/tv/:id/:season/:episode`                     | Real episode player                                                                  |
| `/dashboard`                                        | Redirect to `/dashboard/health`                                                      |
| `/dashboard/{health,activity,history,graphs,stats}` | Named tabs with explicit placeholder content                                         |
| `/settings`, `/settings#about`                      | Settings controls and a separate read-only About tab                                 |
| Other paths                                         | Not-found screen                                                                     |

`Nav` in `apps/web/src/components/Nav.tsx` has Home, one Dashboard link, Settings, the search field and health pill. Dashboard goes to Health and remains active on every dashboard route; there is no dashboard dropdown or separate Search link. `NavSearch` in `apps/web/src/components/NavSearch.tsx` is part of the initial shell, while results remain lazy. See [navigation search](search.md) for debounce, history, keyboard and phone behavior.

`HealthPill` in `apps/web/src/components/HealthPill.tsx` displays real checks and request failures even though its dashboard destination is a placeholder. In desktop compact mode, `apps/web/src/components/HealthPill.module.css` hides only the visible text at **`width < 1200px`**, including fractional widths such as 1199.4 px; at 1200 px the compact rule no longer applies. The ordinary rule remains **`max-width: 899px`**. The status dot, full accessible name and tooltip remain. `apps/web/src/components/Nav.test.tsx` checks these CSS boundaries. See [data and startup](data-and-startup.md#health-reconciliation) for health concurrency.

## Home and search

`HomePage` in `apps/web/src/pages/HomePage.tsx` renders a nonempty Continue Watching row, featured banner, Trending Movies, Trending Shows, Popular Movies and Popular Shows, in that order. Skeletons cover initial loading; a failed initial request offers Retry, and existing data can remain visible. Only a desktop bridge plus missing required config records can replace Home with setup. `apps/web/src/desktop/useMissingKeys.ts` ignores cached config records without the bridge: a plain browser keeps ordinary Home/error UI, not desktop config-edit/restart controls. Missing keys can still prevent catalog requests from succeeding; this does not bypass server configuration. See [desktop setup](desktop-integration.md#setup-chrome-and-settings).

`Banner` in `apps/web/src/components/Banner.tsx` defaults to a **9-second** rotation, pausing on hover, contained focus, reduced motion or offscreen state. Inactive slides are inert; arrows/dots wrap and keyboard dot navigation moves focus. The first `w1280` backdrop is high priority; its load/error permits the next image, and later selection permits current/next images. Movie Play opens playback; series use View show. Optional interval assignment is covered under [telemetry](../../systems/telemetry.md).

`ContinueWatchingRow` in `apps/web/src/components/ContinueWatchingRow.tsx` opens details, including episode parameters for shows. It displays saved fraction/time or Up next. Removal immediately filters the Home cache, sends DELETE, and invalidates Home on failure. Playback exit invalidates Home and progress so revisiting does not retain pre-playback data; see [viewing progress](../../features/viewing-progress.md).

`SearchPage` in `apps/web/src/pages/SearchPage.tsx` has no input of its own. It searches trimmed URL text after **300 ms** and at least **2 characters**, or immediately on Enter. All/Movies/Shows filtering uses received results without fetching again. Empty and failed requests have distinct states; [navigation search](search.md) owns the full interaction model.

## Details and actions

`useTmdbId` in `apps/web/src/lib/useTmdbId.ts` rejects invalid IDs before fetching. Metadata and progress queries are independent; progress failure falls back to Play rather than blocking metadata. Shared error presentation distinguishes 404 from retryable screen failures.

`PlayActions` in `apps/web/src/components/PlayActions.tsx` gives pending downloads precedence over actions, then waits for progress, then offers Play/Watched or Resume plus Start over. Resume floors saved seconds into `?start=...`; Start over explicitly uses zero. These routes now create real sessions. An episode-row Play link is separate from the panel's download-suppressed actions.

`MovieDetailsPage` in `apps/web/src/pages/MovieDetailsPage.tsx` prefetches its title on mount. `ShowDetailsPage` in `apps/web/src/pages/ShowDetailsPage.tsx` prefetches when an episode is selected, not merely on season change. The shared prefetch helper deduplicates each title for **1 second**, including interleaved A/B/A requests; failures are ignored. See [prefetch](../../features/prefetch.md).

Shows put nonempty numbered seasons before Specials, fall back to available selections, replace season/episode URL parameters and render episodes in **100-item** increments. Episode rows/panels share saved progress; missing artwork falls back to dimmed show art.

Episode spoiler protection is **on by default**, including while progress is unknown or an episode is in progress. Rows and the selected panel omit unfinished episode overviews from the DOM and request **w92** stills drawn in the normal-sized slot. Completed episodes use **w300** stills and real overviews; no CSS blur/filter is applied (`apps/web/src/components/EpisodeRow.tsx`, `apps/web/src/components/EpisodePanel.tsx`). Continue Watching applies the small-still rule to episode cards, including Up next, but leaves movie/show fallback backdrops unchanged (`apps/web/src/components/ContinueWatchingRow.tsx`). See [Settings and spoilers](settings-and-spoilers.md#episode-spoiler-policy) for persistence and edge cases.

## Cast and related titles

Both details pages pass their existing metadata response to `DetailsExtras` in `apps/web/src/components/DetailsExtras.tsx`. Movies place the rows below the hero; shows place them after episodes. Cast comes first, then More like this; an empty row is omitted, and two empty arrays produce no extras container. The client preserves response order and makes no separate credits/recommendations request. Server aggregation and bounded/defaulted shared fields are described in [catalog](../../features/catalog.md) and [shared contracts](../../packages/shared.md).

`CastRow` in `apps/web/src/components/CastRow.tsx` uses lazy, async **w185** headshots in **96×96** slots. Missing or failed photos use first/last initials; an empty character name omits that line. Cast entries are plain text, not actor navigation. More like this uses normal poster cards linking to movie/show details (`apps/web/src/components/PosterCard.tsx`).

`RowSection` in `apps/web/src/components/RowSection.tsx` shares heading/list structure between cast and poster rows. Its CSS applies `content-visibility: auto` to below-fold lists, with separate compact/poster reserved heights, without skipping their headings (`apps/web/src/components/RowSection.module.css`).

## Settings and styling

`SettingsPage` in `apps/web/src/pages/SettingsPage.tsx` has accessible Settings/About tabs. Settings contains This device and, in Electron, Desktop controls; About contains read-only application/server/network/playback facts. Tab selection uses the URL hash without adding history entries. Details and modification points are in [Settings and spoilers](settings-and-spoilers.md).

`apps/web/src/styles/tokens.css` owns design tokens; `apps/web/src/styles/global.css` supplies global focus/loading rules and local Inter. Components use CSS modules and inline icons. Posters use lazy `w342` images, details `w500` posters and `w1280` backdrops. Below-fold rows use `content-visibility: auto`. Desktop navigation is draggable with no-drag controls and caption-button clearance; the shell owns the actual buttons.

## Notifications and toasts

`DownloadNotices` in `apps/web/src/notices/DownloadNotices.tsx` converts SSE outcomes to notices. Ready includes Play, looking up resumable movie/episode progress before navigating; lookup failure starts normally. Download failure offers Retry through the player route.

`toastStore` in `apps/web/src/notices/toastStore.ts` holds **one toast**, replacing the previous one. Informational notices last **5 seconds**, ready notices **10 seconds**, errors persist until dismissed or acted on. `ToastHost` in `apps/web/src/notices/ToastHost.tsx` uses a polite live region and suspends dismissal while hovered/focused. Ready notices are held while a player route is open, rather than interrupting playback. Desktop Windows notifications are a separate shell responsibility.

## Key source files

Change route/chrome composition centrally; reuse shared action and error components rather than implementing parallel progress policy. Add notice behavior through the outcome subscription and store, not a second EventSource.

| File                                                   | Purpose                                         |
| ------------------------------------------------------ | ----------------------------------------------- |
| `apps/web/src/App.tsx`                                 | Route table                                     |
| `apps/web/src/components/Layout.tsx`                   | Chrome, boundaries and notice hosts             |
| `apps/web/src/components/HealthPill.module.css`        | Ordinary and compact status-text breakpoints    |
| `apps/web/src/desktop/useMissingKeys.ts`               | Bridge-gated first-run eligibility              |
| `apps/web/src/pages/HomePage.tsx`                      | Home and setup composition                      |
| `apps/web/src/components/Banner.tsx`                   | Rotation, accessibility and image scheduling    |
| `apps/web/src/pages/ShowDetailsPage.tsx`               | Season/episode state and pagination             |
| `apps/web/src/components/DetailsExtras.tsx`            | Conditional cast and More like this composition |
| `apps/web/src/components/CastRow.tsx`                  | Cast text, headshots and initials               |
| `apps/web/src/components/RowSection.tsx`               | Shared horizontal rows                          |
| `apps/web/src/components/EpisodePanel.tsx`             | Selected episode and spoiler-aware presentation |
| `apps/web/src/components/PlayActions.tsx`              | Play, resume and download precedence            |
| `apps/web/src/notices/DownloadNotices.tsx`             | Ready/failure actions                           |
| `apps/web/src/pages/ResumeFlow.test.tsx`               | Home/progress refresh after playback            |
| `apps/web/src/components/DetailsExtras.test.tsx`       | Ordering, empty rows and image failures         |
| `apps/web/src/pages/ShowDetailsPage.spoilers.test.tsx` | Completion/loading/local preference rules       |
| `apps/web/src/notices/notices.test.tsx`                | Notice rendering and actions                    |

Measured tracked scope: `apps/web/src/pages/`, `apps/web/src/components/`, `apps/web/src/notices/` contain **45 production files**, **19 unit/component tests**, **19/45 = 0.42** test-to-source file ratio. Browser specs are excluded from this narrower ratio. Unique human authors: **1**. Method and exclusions: [web inventory](index.md#measured-scope).
