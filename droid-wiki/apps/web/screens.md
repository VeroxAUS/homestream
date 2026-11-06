# Screens

Active contributors: VeroxAUS

## Purpose

The browser supports browsing and progress-aware title actions, but does not yet play media. This page follows the implemented route components and their shared presentation pieces; [data and startup](data-and-startup.md) explains their requests.

## Layout and route map

`apps/web/src/App.tsx` lazy-loads every page under the persistent `Layout` from `apps/web/src/components/Layout.tsx`. `Nav` in `apps/web/src/components/Nav.tsx` exposes Home, Search, a dashboard dropdown and Settings, with a health pill and search shortcut. The dropdown closes on outside pointer input or Escape.

| Route                                               | Behavior and source                                                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                 | Home rows and featured carousel, `apps/web/src/pages/HomePage.tsx`                                                                             |
| `/search?q=...`                                     | Debounced mixed-media search with local type filters, `apps/web/src/pages/SearchPage.tsx`                                                      |
| `/movie/:id`                                        | Movie metadata, download state and saved progress, `apps/web/src/pages/MovieDetailsPage.tsx`                                                   |
| `/tv/:id?season=...&episode=...`                    | Show metadata, season tabs and episode selection, `apps/web/src/pages/ShowDetailsPage.tsx`                                                     |
| `/play/*`                                           | “Player not available yet,” `apps/web/src/pages/PlayerPage.tsx`                                                                                |
| `/dashboard`                                        | Replaces the URL with `/dashboard/health`, `apps/web/src/App.tsx`                                                                              |
| `/dashboard/{health,activity,history,graphs,stats}` | Named tabs with unavailable-dashboard message, `apps/web/src/pages/dashboard/tabs.ts`, `apps/web/src/pages/dashboard/DashboardPlaceholder.tsx` |
| `/settings`                                         | Local device naming and server information, `apps/web/src/pages/SettingsPage.tsx`                                                              |
| Other paths                                         | Not-found screen with Home link, `apps/web/src/pages/NotFoundPage.tsx`                                                                         |

The health pill is real even though its destination dashboard is not. `describeHealth` in `apps/web/src/components/HealthPill.tsx` maps health checks to healthy/warning/problem labels and shows “Server unreachable” after request failure.

## Home and search flow

Home displays a nonempty Continue Watching row, the featured banner, Trending Movies, Trending Shows, Popular Movies and Popular Shows, in that order. Empty featured data removes the banner. Loading uses skeletons; a failed initial request shows Retry, while existing data remains displayable (`apps/web/src/pages/HomePage.tsx`).

`Banner` in `apps/web/src/components/Banner.tsx` starts at **9,000 ms** per slide, supplied by `apps/web/src/lib/bannerInterval.ts`. It pauses for hover, contained focus, reduced motion and offscreen state. Arrows and dots wrap; Left/Right on dots changes and focuses the selected dot. Inactive slides are inert. The first backdrop is requested at `w1280` with high priority; completion or failure makes the next image eligible, and subsequent selection enables the current and next images. The optional interval experiment is described under [telemetry](../../systems/telemetry.md).

`ContinueWatchingRow` in `apps/web/src/components/ContinueWatchingRow.tsx` links to details, including season/episode parameters for shows; it does not start playback. It shows progress/remaining time or an Up next badge. Removal immediately filters `['home']`, sends a schema-checked DELETE, and invalidates Home on failure rather than maintaining a separate rollback copy. See [viewing progress](../../features/viewing-progress.md) for server rules.

Search initializes from `q`, trims input, waits **300 ms** after changes and sends no query for blank text. Input is limited to **200 characters**; edits replace URL parameters and Escape clears the box. All/Movies/Shows filters operate on received results without another request. Empty results and server errors have distinct UI (`apps/web/src/pages/SearchPage.tsx`).

## Details and action state

`useTmdbId` in `apps/web/src/lib/useTmdbId.ts` accepts positive decimal IDs of 1–10 digits; invalid addresses do not fetch details. Movie/show metadata and progress load independently. Details 404s become title-not-found screens; other errors show Retry (`apps/web/src/components/DetailsError.tsx`).

`PlayActions` in `apps/web/src/components/PlayActions.tsx` defines the shared action precedence:

1. Pending download: replace panel actions with a disabled-status Downloading badge.
2. Progress still loading: render a placeholder.
3. Missing, nonresumable or failed progress: offer Play, with Watched when completed.
4. Resumable progress: link to `?start=<floored seconds>`, plus Start over at `?start=0`, and show watched fraction and time remaining.

These links do not create a session, write progress, or consume the start parameter yet. The current `apps/web/src/pages/PlayerPage.tsx` only renders the placeholder. Movie banner Play and episode-row Play links also lead there. Download suppression applies to `PlayActions`; the separate episode-row link remains present (`apps/web/src/components/EpisodeRow.tsx`).

Shows sort nonempty numbered seasons first and Specials last, falling back to the first season/episode when the requested selection is unavailable (`apps/web/src/lib/seasons.ts`, `apps/web/src/pages/ShowDetailsPage.tsx`). Selecting a season/episode replaces query parameters. Episodes render in batches of **100**, extended by Show more episodes. `EpisodeRow` and `EpisodePanel` in `apps/web/src/components/EpisodeRow.tsx` and `apps/web/src/components/EpisodePanel.tsx` share saved progress and selected-episode data; missing stills use dimmed show art.

## Settings and presentation

Settings saves the trimmed device name locally, registers the updated capability profile, and distinguishes a server-accepted save from a local-only save. About shows server name/version/port, current page origin, LAN addresses, a fixed redacted stream-source label and the browser playback profile. It does not edit server configuration or expose upstream credentials (`apps/web/src/pages/SettingsPage.tsx`).

Design tokens are in `apps/web/src/styles/tokens.css`; global focus, tabular numerals, loading animation and self-hosted Inter are in `apps/web/src/styles/global.css`. Components use CSS modules and inline SVG from `apps/web/src/components/Icon.tsx`. Posters request `w342` images lazily; details use `w500` posters and `w1280` backdrops through `apps/web/src/lib/images.ts`. Below-fold poster rows use `content-visibility: auto` (`apps/web/src/components/PosterRow.module.css`). Desktop navigation is a CSS drag region with interactive elements excluded, but caption buttons and window creation are not implemented here (`apps/web/src/components/Nav.module.css`).

## Modification points

Change route composition in `apps/web/src/App.tsx`, shared action rules in `apps/web/src/components/PlayActions.tsx`, and season selection in `apps/web/src/lib/seasons.ts`. Keep server progress policy out of presentation helpers; follow the [catalog](../../features/catalog.md) and [shared](../../packages/shared.md) contracts.

## Key source files

| File                                              | Purpose                                            |
| ------------------------------------------------- | -------------------------------------------------- |
| `apps/web/src/pages/HomePage.tsx`                 | Home load states and row ordering                  |
| `apps/web/src/components/Banner.tsx`              | Carousel timer, focus and image scheduling         |
| `apps/web/src/components/ContinueWatchingRow.tsx` | Resume cards and optimistic removal                |
| `apps/web/src/pages/SearchPage.tsx`               | Debounce, URL query and local filtering            |
| `apps/web/src/pages/MovieDetailsPage.tsx`         | Movie details/progress composition                 |
| `apps/web/src/pages/ShowDetailsPage.tsx`          | Season/episode URL state and pagination            |
| `apps/web/src/components/PlayActions.tsx`         | Download/Play/Resume/Watched states                |
| `apps/web/src/pages/SettingsPage.tsx`             | Device naming and server facts                     |
| `apps/web/src/pages/PlayerPage.tsx`               | Explicit player limitation                         |
| `apps/web/src/pages/ShowDetailsPage.test.tsx`     | Deep links, progress, downloads and episode paging |
| `apps/web/src/components/Banner.test.tsx`         | Carousel timing, image order and pause behavior    |

Measured tracked scope for `apps/web/src/pages/`, `apps/web/src/components/` and `apps/web/src/lib/`: **39 production TS/TSX files**, **10 tests**, **0.26 test-to-code file ratio**; declarations/CSS excluded. Default-branch human authors: **1** (VeroxAUS). See [build and tests](build-and-tests.md) for the wider test architecture.
