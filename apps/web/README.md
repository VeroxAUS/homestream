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

## Bundle budget

`.size-limit.json` holds the budget. CI runs `build` and `size` on every push, and `pnpm readiness:audit` fails when the budget file or the `size` script is missing.

| Chunk                             | Budget (gzip) | Contents                                                               |
| --------------------------------- | ------------- | ---------------------------------------------------------------------- |
| Initial JavaScript (`index-*.js`) | 150 kB        | React, the shared schemas and the app shell                            |
| Telemetry (`telemetry-*.js`)      | 100 kB        | Sentry and PostHog, loaded after Home is shown and the browser is idle |

Features that add heavy code (player, charts) load it lazily and add an entry for their chunk to `.size-limit.json` in the same change.

## API calls, logging and errors

- Call the server through `apiFetch` / `apiGet` in `src/api/client.ts`. It adds an `X-Request-ID` header (the server writes it as `reqId` in its log and echoes it), leaves a breadcrumb and throws `ApiError` (`{status, code, message, hint, requestId}`). `apiGet` validates the response with a schema from `@homestream/shared`.
- Log through `logger` in `src/logger.ts` (`debug`, `info`, `warn`, `error` with a category and small scalar data). Entries become Sentry breadcrumbs once telemetry is running. Never log URLs with tokens, stream URLs or user text.

## Telemetry

Full description of what is sent: [docs/PRIVACY.md](../../docs/PRIVACY.md). Code: `src/telemetry/`.

- **Off by default.** The keys (`SENTRY_DSN_WEB`, `POSTHOG_API_KEY`, `POSTHOG_HOST`) are read when the UI is built (from the environment or the repository `.env`) and baked into the bundle. A build without them contains no key and makes no telemetry request, not even for the telemetry chunk. `HOMESTREAM_TELEMETRY=off` at build time switches everything off, and `localStorage['homestream.telemetry'] = 'off'` does the same in one browser.
- **Does not slow Home.** `src/telemetry/index.ts` is part of the initial bundle and imports neither Sentry nor PostHog. It waits for the performance mark `hs:home-content` (exported as `HOME_CONTENT_MARK`; the Home screen sets it when its rows are rendered, `App` sets it once the server answered) and for browser idle time, then loads the `telemetry-*.js` chunk.
- **Sentry** (`@sentry/react`, project `homestream-web`): errors only, no tracing, replay or session tracking. Release `homestream@<version>`, tags `app=web`, `process=renderer`, `device.kind=web|desktop` and the `route` template. Events pass through the shared sanitizer (`sanitizeSentryEvent`): no user, IP, cookies, headers or query strings; script locations lose their origin (`app:///assets/...`).
- **PostHog** (`posthog-js`, slim build): autocapture, session recording, surveys, flags and automatic page views are off, `person_profiles` is `identified_only`, and a `before_send` hook drops every event that is not in the typed catalog of `@homestream/shared`. Report a page with `usePageView(location.pathname)` once in the top-level layout: it sends the catalog event `page_viewed` with the **route template** (`/movie/:id`), never the real path. Add events to the catalog and to docs/PRIVACY.md first, then call `captureEvent` in `src/telemetry/posthog.ts`.
- **Source maps** are produced only for release builds (`HOMESTREAM_RELEASE_BUILD=1` with `SENTRY_AUTH_TOKEN` and `SENTRY_ORG`), uploaded with `@sentry/vite-plugin` under release `homestream@<version>`, and deleted from `dist/` afterwards. Ordinary builds contain no source maps.
- **Test trigger.** A build made with `HOMESTREAM_TELEMETRY_STUB=1` honors `?__telemetry_test=<run id>` and reports one deliberate error tagged with the run id. Other builds ignore the parameter.

## End-to-end tests

`pnpm --filter @homestream/web test:e2e` (build the server first: `pnpm --filter @homestream/server build`; Chromium is installed once with `pnpm --filter @homestream/web exec playwright install chromium`, set `PLAYWRIGHT_BROWSERS_PATH` to keep the download off the system drive).

`e2e/build.mjs` builds the UI twice into `reports/e2e-dist`: `plain` (no telemetry key at all) and `stub` (Sentry and PostHog point at local receivers, test trigger on). `playwright.config.ts` starts a stub hub (`e2e/support/hub.mjs`: TMDB, gateway, Sentry and PostHog receivers) and two real servers, each with its own data directory, an env file that does not exist, no real keys, `SOURCE_PROXY_PORT=0` and `MAX_DOWNLOAD_MBPS=60`. `e2e/support/redirect-fetch.mjs` points the server's TMDB calls at the stub and refuses every other request that would leave the machine. Ports (8602 to 8607) are in `e2e/ports.json`.

No test starts a playback session. Add new specs to `e2e/*.spec.ts`; use the `plain` project (`baseURL` of the plain server) for UI behavior and the `telemetry` project for anything that inspects what Sentry or PostHog receive (`GET /__captured` on the Sentry receiver port, `DELETE` clears it).
