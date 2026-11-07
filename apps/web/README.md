# @homestream/web

The HomeStream web UI: React 19 + Vite. The server serves the built UI at `/` (`apps/web/dist`, or `HOMESTREAM_WEB_DIR`). The Electron shell ([apps/desktop](../desktop/README.md)) loads the same UI from the server.

## Commands

Run from the repository root.

| Command                               | What it does                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm --filter @homestream/web dev`   | Vite dev server on port 8601, proxies `/api` and `/hls` to the server on 8600                   |
| `pnpm --filter @homestream/web build` | Typecheck and production build into `dist/`                                                     |
| `pnpm --filter @homestream/web test`  | Component and unit tests (Vitest, jsdom, Testing Library), next to the source as `*.test.ts(x)` |
| `... test:coverage`                   | The same with the coverage thresholds of `coverage-thresholds.json` (they only go up)           |
| `... analyze`                         | Production build into `reports/analyze-dist` and a treemap at `reports/bundle.html`             |
| `... size`                            | Bundle budget (size-limit) against `dist/`; run `build` first                                   |
| `... test:e2e`                        | Playwright end-to-end tests (see below)                                                         |

## Screens and conventions

- Routes (`src/App.tsx`, all lazy): `/` Home, `/search`, `/movie/:id`, `/tv/:id` (`?season=&episode=`), `/play/movie/:id` and `/play/tv/:id/:season/:episode` (the player), `/dashboard/{health,activity,history,graphs,stats}` and `/settings`. The server answers every one of these paths with `index.html`, so deep links and reloads work.
- Design tokens (dark theme, red accent) are in `src/styles/tokens.css`; Inter is self-hosted from `src/styles/fonts/`. No `backdrop-filter`, no icon fonts: icons are inline SVG (`components/Icon.tsx`).
- Data comes from TanStack Query hooks in `src/api/queries.ts`, all built on `apiGet` and the shared schemas. Pending downloads show a "Downloading n%" badge instead of Play and update from the `/api/events` stream (`src/events/`), which opens after Home is shown.
- A play link carries the resume point as `?start=<seconds>` (`?start=0` to start over); the player reads it.
- The player (`src/player/`, page `pages/PlayerPage.tsx`) starts a session with `streamId: "auto"` and no `subtitle` field, loads the master playlist with hls.js and maps its subtitle renditions to server track indexes by the ` [idx]` NAME suffix. Controls hide after 3 s idle (DOM attribute, no React renders while playing), keys and Media Session work while they are hidden, and `getPlayerSnapshot()` (`player/snapshot.ts`) exposes session, position, volume and track choices for a hand-over to another window. Details pages send one `POST /api/prefetch` per movie opened or episode selected.
- This browser registers itself with `POST /api/devices` after Home is shown: a random id kept in `localStorage`, kind `desktop` when `window.homestream.isDesktop`, otherwise `web`, and the fixed profile H.264 only, SDR, 3840x2160, stereo. The device name is editable on the Settings page.
- Component tests mock `fetch` with `mockApi` from `src/test/render.tsx` and use the shared-type fixtures in `src/test/fixtures.ts`.

## Bundle budget

`.size-limit.json` holds the budget. CI runs `build` and `size` on every push, and `pnpm readiness:audit` fails when the budget file or the `size` script is missing.

| Chunk                             | Budget (gzip) | Contents                                                               |
| --------------------------------- | ------------- | ---------------------------------------------------------------------- |
| Initial JavaScript (`index-*.js`) | 150 kB        | React, router, TanStack Query, the shared schemas and the app shell    |
| All CSS                           | 24 kB         | Tokens, global styles and the CSS modules                              |
| Route chunks (`*Page-*.js`)       | 40 kB total   | One chunk per page (not the player), loaded on navigation              |
| Player (`PlayerPage-*.js`)        | 210 kB        | The player page with hls.js, loaded only when a title is played        |
| Inter font (`Inter-*.woff2`)      | 50 kB         | The one self-hosted font file, preloaded from `index.html`             |
| Telemetry (`telemetry-*.js`)      | 100 kB        | Sentry and PostHog, loaded after Home is shown and the browser is idle |

The build also writes `.br` and `.gz` copies of every text asset (`vite.plugins.ts`); the server sends them when the client accepts them, and serves `/assets/*` with a one-year immutable cache header and everything else with `no-cache`.
Features that add heavy code (player, charts) load it lazily and add an entry for their chunk to `.size-limit.json` in the same change.

## API calls, logging and errors

- Call the server through `apiFetch` / `apiGet` in `src/api/client.ts`. It adds an `X-Request-ID` header (the server writes it as `reqId` in its log and echoes it), leaves a breadcrumb and throws `ApiError` (`{status, code, message, hint, requestId}`). `apiGet` validates the response with a schema from `@homestream/shared`.
- Log through `logger` in `src/logger.ts` (`debug`, `info`, `warn`, `error` with a category and small scalar data). Entries become Sentry breadcrumbs once telemetry is running. Never log URLs with tokens, stream URLs or user text.

## Telemetry

Full description of what is sent: [docs/PRIVACY.md](../../docs/PRIVACY.md). Code: `src/telemetry/`.

- **Off by default.** The keys (`SENTRY_DSN_WEB`, `POSTHOG_API_KEY`, `POSTHOG_HOST`) are read when the UI is built (from the environment or the repository `.env`) and baked into the bundle. A build without them contains no key and makes no telemetry request, not even for the telemetry chunk. `HOMESTREAM_TELEMETRY=off` at build time switches everything off, and `localStorage['homestream.telemetry'] = 'off'` does the same in one browser.
- **Does not slow Home.** `src/telemetry/index.ts` is part of the initial bundle and imports neither Sentry nor PostHog. It waits for the performance mark `hs:home-content` (exported as `HOME_CONTENT_MARK`; the Home screen sets it when its rows are rendered, `App` sets it once the server answered) and for browser idle time, then loads the `telemetry-*.js` chunk.
- **Sentry** (`@sentry/react`, project `homestream-web`): errors only, no tracing, replay or session tracking. Release `homestream@<version>`, tags `app=web`, `process=renderer`, `device.kind=web|desktop` and the `route` template. Events pass through the shared sanitizer (`sanitizeSentryEvent`): no user, IP, cookies, headers or query strings; script locations lose their origin (`app:///assets/...`).
- **PostHog** (`posthog-js`, slim build): autocapture, session recording, surveys and automatic page views are off, and the only flag read is `banner-rotation-interval` (`watchFlag`; it sets the banner interval to 9 s or 12 s, and a failed lookup keeps 9 s), `person_profiles` is `identified_only`, and a `before_send` hook drops every event that is not in the typed catalog of `@homestream/shared`. Report a page with `usePageView(location.pathname)` once in the top-level layout: it sends the catalog event `page_viewed` with the **route template** (`/movie/:id`), never the real path. Add events to the catalog and to docs/PRIVACY.md first, then call `captureEvent` in `src/telemetry/posthog.ts`.
- **Source maps** are produced only for release builds (`HOMESTREAM_RELEASE_BUILD=1` with `SENTRY_AUTH_TOKEN` and `SENTRY_ORG`), uploaded with `@sentry/vite-plugin` under release `homestream@<version>`, and deleted from `dist/` afterwards. Ordinary builds contain no source maps.
- **Test trigger.** A build made with `HOMESTREAM_TELEMETRY_STUB=1` honors `?__telemetry_test=<run id>` and reports one deliberate error tagged with the run id. Other builds ignore the parameter.

## End-to-end tests

`pnpm --filter @homestream/web test:e2e` (build the server first: `pnpm --filter @homestream/server build`; Chromium is installed once with `pnpm --filter @homestream/web exec playwright install chromium`, set `PLAYWRIGHT_BROWSERS_PATH` to keep the download off the system drive).

`e2e/build.mjs` builds the UI twice into `reports/e2e-dist`: `plain` (no telemetry key at all) and `stub` (Sentry and PostHog point at local receivers, test trigger on). `playwright.config.ts` starts a stub hub (`e2e/support/hub.mjs`: TMDB, gateway, Sentry and PostHog receivers) and two real servers, each with its own data directory, an env file that does not exist, no real keys, `SOURCE_PROXY_PORT=0` and `MAX_DOWNLOAD_MBPS=60`. `e2e/support/redirect-fetch.mjs` points the server's TMDB calls at the stub and refuses every other request that would leave the machine. Ports (8602 to 8607) are in `e2e/ports.json`.

`e2e/resume.spec.ts` seeds `progress` and `plays` rows straight into the plain server's SQLite file (the rows a played session leaves behind) and checks Continue Watching, Resume / Start over and removal against the real server. No test starts a playback session. Add new specs to `e2e/*.spec.ts`; use the `plain` project (`baseURL` of the plain server) for UI behavior and the `telemetry` project for anything that inspects what Sentry or PostHog receive (`GET /__captured` on the Sentry receiver port, `DELETE` clears it).
