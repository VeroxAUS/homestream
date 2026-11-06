# Build and tests

Active contributors: VeroxAUS

## Purpose and layout

The browser build keeps routes lazy, telemetry outside initial JavaScript, and static assets ready for compressed server delivery. Tests cover components in jsdom and the built UI against isolated stub services (`apps/web/vite.config.ts`, `apps/web/playwright.config.ts`). This page describes test infrastructure, not results from a run during wiki generation.

Build settings live in `apps/web/vite.config.ts` and `apps/web/vite.plugins.ts`. Unit/component helpers live in `apps/web/src/test/`; browser fixtures and receivers live in `apps/web/e2e/support/`.

## Asset flow and budgets

Vite development uses port **8601**, proxying `/api` and `/hls` to **8600**. The production build typechecks and writes `apps/web/dist`; analyze mode writes `apps/web/reports/analyze-dist` and a treemap at `apps/web/reports/bundle.html` (`apps/web/package.json`, `apps/web/vite.config.ts`).

`preloadFont` and `preCompress` in `apps/web/vite.plugins.ts` add a preload for the emitted WOFF2 font and write gzip/Brotli sidecars for text assets of at least **1,024 bytes**. The self-hosted Inter font is declared in `apps/web/src/styles/global.css`. The server serves the resulting app; no separate production Vite process is needed.

| Budget in `apps/web/.size-limit.json`  | Limit           |
| -------------------------------------- | --------------- |
| Initial `index-*.js`                   | 150 kB gzip     |
| All CSS                                | 24 kB gzip      |
| Route `*Page-*.js` chunks **together** | 40 kB gzip      |
| `inter-var-*.woff2`                    | 50 kB, not gzip |
| Deferred `telemetry-*.js`              | 100 kB gzip     |

The route limit is aggregate, not per page. These are configured ceilings, not measured bundle sizes. Heavy player/chart additions need their own lazy boundaries and matching budget updates. Source maps are hidden and upload-enabled only when `HOMESTREAM_RELEASE_BUILD=1`, a nonempty `SENTRY_AUTH_TOKEN` exists and telemetry is not disabled; the plugin targets `homestream-web` and removes `./dist/**/*.map` after upload (`apps/web/vite.config.ts`). Ordinary builds produce no maps. For build-time keys and the SDK-free initial facade, see [telemetry](../../systems/telemetry.md).

## Test abstractions

Vitest uses jsdom, shared-source aliases, V8 coverage and colocated `*.test.ts(x)` files (`apps/web/vite.config.ts`). `mockApi` in `apps/web/src/test/render.tsx` replaces fetch with a method/path reply table, records calls and returns 404 for unlisted requests. Replies may be JSON, Response, Error or an async handler. `renderWithProviders` supplies MemoryRouter and an isolated Query client with retries disabled; `apps/web/src/test/setup.ts` cleans up components, stubs scrolling and suppresses development logging.

Fixtures in `apps/web/src/test/fixtures.ts` use shared types. Tests exercise Home row ordering, optimistic removal, carousel image/timer behavior, search debounce, details/deep links, progress/download states, naming, navigation and placeholders. Start with `apps/web/src/App.test.tsx` for route coverage and `apps/web/src/events/events.test.tsx` for FakeEventSource-driven state updates.

Configured coverage thresholds are **95% lines, 98% functions, 89% branches and 95% statements** (`apps/web/coverage-thresholds.json`). These are required thresholds, not fresh observed coverage.

## Isolated browser flow

`apps/web/e2e/build.mjs` checks for a built server and builds two UIs after explicitly clearing telemetry environment inputs:

- **plain:** no telemetry keys.
- **stub:** local Sentry/PostHog receivers and a stub-only deliberate-error trigger.

`apps/web/playwright.config.ts` starts a loopback stub hub and two real server processes with separate data/transcode roots, nonexistent env-file paths, server telemetry off, random source-proxy ports and a 60 MB/s download cap. Fixed test ports **8602–8607** are assigned in `apps/web/e2e/ports.json`; one worker runs serially, with one retry in CI. `apps/web/e2e/support/redirect-fetch.mjs` redirects server TMDB fetches to the stub and refuses other non-loopback fetch destinations.

`apps/web/e2e/support/hub.mjs` supplies metadata/artwork, a gateway manifest with empty stream lists, captured Sentry/PostHog payloads and flag replies. `apps/web/e2e/smoke.spec.ts` checks actual rows, request IDs, deep-link reloads, device registration and no-key behavior. `apps/web/e2e/telemetry.spec.ts` checks scrubbed reports, template page views, opt-out and interval assignment. No spec starts playback; these are not encoder or media-player tests.

## Commands and modification points

Run from the repository root:

```sh
pnpm --filter @homestream/web test
pnpm --filter @homestream/web test:coverage
pnpm --filter @homestream/web build
pnpm --filter @homestream/web size
pnpm --filter @homestream/server build
pnpm --filter @homestream/web test:e2e
```

Browser tests require Chromium installed separately. Keep unit tests offline with `mockApi`; add browser assertions to the plain or telemetry project according to what they verify. Preserve explicit environment isolation when changing `apps/web/e2e/build.mjs`. See [testing](../../how-to-contribute/testing.md) for repository-wide tiers and [Web](index.md) for the implementation map.

## Key source files

| File                                      | Purpose                                      |
| ----------------------------------------- | -------------------------------------------- |
| `apps/web/vite.config.ts`                 | Build, proxy, chunks, source maps and Vitest |
| `apps/web/vite.plugins.ts`                | Precompression and font preload              |
| `apps/web/.size-limit.json`               | Aggregate asset budgets                      |
| `apps/web/coverage-thresholds.json`       | Coverage ratchet baseline                    |
| `apps/web/src/test/render.tsx`            | Mock fetch and component providers           |
| `apps/web/src/test/fixtures.ts`           | Shared-type fixture factories                |
| `apps/web/e2e/build.mjs`                  | Plain/stub environment isolation             |
| `apps/web/playwright.config.ts`           | Server lifecycle and browser projects        |
| `apps/web/e2e/support/hub.mjs`            | Stub upstreams and collectors                |
| `apps/web/e2e/support/redirect-fetch.mjs` | Server-side outbound fetch restriction       |

Measured tracked web scope: **57 production TS/TSX files**, **26 test/spec files** including **2 browser specs**, **0.46 test-to-code file ratio**; declarations, helpers, CSS and configuration excluded from production count. Default-branch human authors: **1** (VeroxAUS). No browser, build or test suite was run for these pages.
