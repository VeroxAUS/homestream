# Screens

Active contributors: VeroxAUS

The web routes implement browsing, search, title details, playback and Settings. This page covers presentation and notices; [player](player.md) and [desktop integration](desktop-integration.md) explain session and shell behavior.

## Layout and routes

`App` in `apps/web/src/App.tsx` lazy-loads route components. `Layout` in `apps/web/src/components/Layout.tsx` provides navigation, route Suspense/error boundaries, shortcut handling and notices. Navigation and the unreachable banner are omitted on `/play` and `/play/*`; the player supplies its own top bar.

| Route | Implemented behavior |
| --- | --- |
| `/` | Home rows, featured banner or desktop first-run setup |
| `/search?q=...` | Debounced mixed-media search with local type filters |
| `/movie/:id` | Metadata, progress, download state and Play/Resume |
| `/tv/:id?season=...&episode=...` | Show details, season tabs and selected-episode panel |
| `/play/movie/:id` | Real movie player, optional `?start=<seconds>` |
| `/play/tv/:id/:season/:episode` | Real episode player |
| `/dashboard` | Redirect to `/dashboard/health` |
| `/dashboard/{health,activity,history,graphs,stats}` | Named tabs with explicit placeholder content |
| `/settings` | Device naming, server facts and desktop-only shell settings |
| Other paths | Not-found screen |

`Nav` in `apps/web/src/components/Nav.tsx` offers Home, Search, Dashboards and Settings. Its dropdown closes on outside pointer input or Escape. `HealthPill` in `apps/web/src/components/HealthPill.tsx` displays real checks and request failures even though its dashboard destination is a placeholder. See [data and startup](data-and-startup.md#health-reconciliation) for health concurrency.

## Home and search

`HomePage` in `apps/web/src/pages/HomePage.tsx` renders a nonempty Continue Watching row, featured banner, Trending Movies, Trending Shows, Popular Movies and Popular Shows, in that order. Skeletons cover initial loading; a failed initial request offers Retry, and existing data can remain visible. The desktop missing-key check can replace Home with setup.

`Banner` in `apps/web/src/components/Banner.tsx` defaults to a **9-second** rotation, pausing on hover, contained focus, reduced motion or offscreen state. Inactive slides are inert; arrows/dots wrap and keyboard dot navigation moves focus. The first `w1280` backdrop is high priority; its load/error permits the next image, and later selection permits current/next images. Movie Play opens playback; series use View show. Optional interval assignment is covered under [telemetry](../../systems/telemetry.md).

`ContinueWatchingRow` in `apps/web/src/components/ContinueWatchingRow.tsx` opens details, including episode parameters for shows. It displays saved fraction/time or Up next. Removal immediately filters the Home cache, sends DELETE, and invalidates Home on failure. Playback exit invalidates Home and progress so revisiting does not retain pre-playback data; see [viewing progress](../../features/viewing-progress.md).

`SearchPage` in `apps/web/src/pages/SearchPage.tsx` trims input, debounces **300 ms**, limits input to **200 characters** and makes no blank query. URL edits replace `q`; Escape clears it. All/Movies/Shows filtering uses received results without fetching again. Empty and failed requests have distinct states.

## Details and actions

`useTmdbId` in `apps/web/src/lib/useTmdbId.ts` rejects invalid IDs before fetching. Metadata and progress queries are independent; progress failure falls back to Play rather than blocking metadata. Shared error presentation distinguishes 404 from retryable screen failures.

`PlayActions` in `apps/web/src/components/PlayActions.tsx` gives pending downloads precedence over actions, then waits for progress, then offers Play/Watched or Resume plus Start over. Resume floors saved seconds into `?start=...`; Start over explicitly uses zero. These routes now create real sessions. An episode-row Play link is separate from the panel's download-suppressed actions.

`MovieDetailsPage` in `apps/web/src/pages/MovieDetailsPage.tsx` prefetches its title on mount. `ShowDetailsPage` in `apps/web/src/pages/ShowDetailsPage.tsx` prefetches when an episode is selected, not merely on season change. The shared prefetch helper deduplicates each title for **1 second**, including interleaved A/B/A requests; failures are ignored. See [prefetch](../../features/prefetch.md).

Shows put nonempty numbered seasons before Specials, fall back to available selections, replace season/episode URL parameters and render episodes in **100-item** increments. Episode rows/panels share saved progress; missing artwork falls back to dimmed show art.

## Settings and styling

`SettingsPage` in `apps/web/src/pages/SettingsPage.tsx` stores a trimmed device name locally and registers it, distinguishing accepted from local-only saves. About shows server identity/version/port, origin, LAN addresses, a redacted stream-source label and conservative playback capabilities. It never exposes upstream credentials. Electron adds settings and version controls through [desktop integration](desktop-integration.md); update checking is explicitly not configured.

`apps/web/src/styles/tokens.css` owns design tokens; `apps/web/src/styles/global.css` supplies global focus/loading rules and local Inter. Components use CSS modules and inline icons. Posters use lazy `w342` images, details `w500` posters and `w1280` backdrops. Below-fold rows use `content-visibility: auto`. Desktop navigation is draggable with no-drag controls and caption-button clearance; the shell owns the actual buttons.

## Notifications and toasts

`DownloadNotices` in `apps/web/src/notices/DownloadNotices.tsx` converts SSE outcomes to notices. Ready includes Play, looking up resumable movie/episode progress before navigating; lookup failure starts normally. Download failure offers Retry through the player route.

`toastStore` in `apps/web/src/notices/toastStore.ts` holds **one toast**, replacing the previous one. Informational notices last **5 seconds**, ready notices **10 seconds**, errors persist until dismissed or acted on. `ToastHost` in `apps/web/src/notices/ToastHost.tsx` uses a polite live region and suspends dismissal while hovered/focused. Ready notices are held while a player route is open, rather than interrupting playback. Desktop Windows notifications are a separate shell responsibility.

## Key source files

Change route/chrome composition centrally; reuse shared action and error components rather than implementing parallel progress policy. Add notice behavior through the outcome subscription and store, not a second EventSource.

| File | Purpose |
| --- | --- |
| `apps/web/src/App.tsx` | Route table |
| `apps/web/src/components/Layout.tsx` | Chrome, boundaries and notice hosts |
| `apps/web/src/pages/HomePage.tsx` | Home and setup composition |
| `apps/web/src/components/Banner.tsx` | Rotation, accessibility and image scheduling |
| `apps/web/src/pages/ShowDetailsPage.tsx` | Season/episode state and pagination |
| `apps/web/src/components/PlayActions.tsx` | Play, resume and download precedence |
| `apps/web/src/notices/DownloadNotices.tsx` | Ready/failure actions |
| `apps/web/src/pages/ResumeFlow.test.tsx` | Home/progress refresh after playback |
| `apps/web/src/notices/notices.test.tsx` | Notice rendering and actions |

Measured committed scope: `src/pages/`, `src/components/`, `src/notices/` contain **34 production files**, **15 tests**, **15/34 = 0.44** test-to-source file ratio. Unique human authors: **1**. Method and exclusions: [web inventory](index.md#measured-scope).
