# Build and tests

Active contributors: VeroxAUS

## Purpose

The web build keeps routes, HLS and telemetry behind lazy boundaries and generates compressed assets for server delivery. `apps/web/vite.config.ts` configures Vite/Vitest; `apps/web/playwright.config.ts` runs isolated browser fixtures. This page describes committed configuration and test scope, not results from a wiki-generation test run.

## Asset flow and budgets

Vite dev listens on **8601**, proxying `/api` and `/hls` to **8600**. `apps/web/package.json` builds with TypeScript checking then Vite into `apps/web/dist`; analyze mode writes `apps/web/reports/analyze-dist` and a treemap at `apps/web/reports/bundle.html`. Production runs behind the HomeStream server, not a separate Vite process.

`preloadFont` and `preCompress` in `apps/web/vite.plugins.ts` preload the emitted WOFF2 and write gzip/Brotli sidecars for compressible text assets of at least **1,024 bytes**. Inter is self-hosted in `apps/web/src/styles/fonts/` and declared by `apps/web/src/styles/global.css`.

| Budget in `apps/web/.size-limit.json`        | Ceiling             |
| -------------------------------------------- | ------------------- |
| Initial `index-*.js`                         | **150 kB gzip**     |
| All CSS                                      | **24 kB gzip**      |
| `*Page-*.js`, excluding PlayerPage, together | **40 kB gzip**      |
| `PlayerPage-*.js`, including hls.js          | **200 kB gzip**     |
| `inter-var-*.woff2`                          | **50 kB**, not gzip |
| Deferred `telemetry-*.js`                    | **100 kB gzip**     |

Route limits are aggregate, not per page; these are ceilings rather than measured build sizes. The [player](player.md) has its own heavy lazy boundary. Telemetry's initial facade imports no SDK; build-time configuration and privacy are covered under [telemetry](../../systems/telemetry.md).

`apps/web/src/bundleBudget.test.ts` checks that the player ceiling is exactly **200 kB** and that `apps/web/README.md` documents the same value. Those checks catch configuration/documentation drift; only a build followed by the size command measures emitted assets. `docs/runbooks/web-bundle-budget.md` covers failures, including keeping full hls.js for subtitles behind the lazy player boundary.

Hidden source maps are enabled only for `HOMESTREAM_RELEASE_BUILD=1`, nonempty `SENTRY_AUTH_TOKEN` and telemetry not disabled. The Sentry plugin targets `homestream-web` and deletes maps under `apps/web/dist/` after upload. Ordinary builds produce no maps (`apps/web/vite.config.ts`).

`apps/web/src/components/NavSearch.tsx` stays in the initial shell. Focus or phone expansion calls the same dynamic import used by the lazy Search route (`apps/web/src/pages/searchRoute.ts`), warming that route without eagerly loading HLS or telemetry. `apps/web/e2e/nav-search.spec.ts` checks that the field is present at the content mark and that first use adds Search code, not player/telemetry code.

## Build environment

Turbo's strict environment mode passes declared variables to tasks. The root `turbo.json` build task declares all ten variables read by the web build: `HOMESTREAM_TELEMETRY`, `HOMESTREAM_TELEMETRY_STUB`, `HOMESTREAM_RELEASE_BUILD`, `POSTHOG_API_KEY`, `POSTHOG_HOST`, `SENTRY_AUTH_TOKEN`, `SENTRY_DSN_WEB`, `SENTRY_ENVIRONMENT`, `SENTRY_ORG` and `SENTRY_RELEASE`.

`apps/web/turbo.json` extends that root configuration and sets web `build.cache` to `false`. Web builds must run instead of restoring cached `dist` output: Vite also reads `.env`, and restoring outputs over an existing directory could leave older key-bearing assets beside the restored files. This override is web-specific, not a repository-wide cache ban.

`apps/web/src/telemetry/turboEnv.test.ts` scans `env.NAME` reads in `apps/web/vite.config.ts`, `apps/web/vite.plugins.ts` and `apps/web/src/telemetry/buildEnv.ts`, compares that set in both directions with the root build declarations, and checks the web cache override. When adding a build variable, update the declaration and preserve this regression guard.

`telemetryFromEnv` in `apps/web/src/telemetry/buildEnv.ts` sets the embedded Sentry DSN, PostHog key and PostHog host to `null` in test mode or a telemetry-off build, even if supplied externally. `apps/web/src/telemetry/buildEnv.test.ts` covers off-build stripping and test-mode isolation. This is stronger than only disabling runtime requests; browser storage opt-out does not remove values from existing assets. See [telemetry](../../systems/telemetry.md) for the runtime/privacy policy.

## Unit and component tests

Vitest uses jsdom, the shared-source alias and V8 coverage. It includes colocated TS/TSX tests under `apps/web/src/` and excludes tests, `apps/web/src/test/` helpers and declarations from instrumented production scope. `apps/web/coverage-thresholds.json` requires **98% lines, 99% functions, 90% branches and 97% statements**; these are configured gates, not freshly observed coverage.

`mockApi` and `renderWithProviders` in `apps/web/src/test/render.tsx` supply a method/path fetch table, request recording, MemoryRouter and isolated Query client with retries disabled. Unlisted calls return 404. `apps/web/src/test/setup.ts` cleans up components and stubs browser behavior. Fixtures use invented data/shared types.

`FakeHls` in `apps/web/src/test/fakeHls.ts`, media helpers in `apps/web/src/test/player.tsx` and bridge doubles in `apps/web/src/test/desktopBridge.ts` simulate HLS events, video state and Electron IPC. They test player lifetime/control logic, not real decode/encoding or Electron process behavior.

| Tests                                                  | Main boundary exercised                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `apps/web/src/pages/PlayerPage.test.tsx`               | Auto-start, 201/202, paused pings, late sessions and fatal Retry  |
| `apps/web/src/pages/PlayerControls.test.tsx`           | Keyboard/buttons, subtitles/audio, info and hidden chrome         |
| `apps/web/src/pages/PlayerExtras.test.tsx`             | Native HLS fallback, pagehide and failed track changes            |
| `apps/web/src/pages/PlayerFailures.test.tsx`           | Rejected browser operations and failure tolerance                 |
| `apps/web/src/player/useHls.test.ts`                   | Status-0 retry predicate/bounds and redundant selection avoidance |
| `apps/web/src/pages/PlayerSubtitleReload.test.tsx`     | Off/non-default subtitle preservation and replaced-stream guards  |
| `apps/web/src/desktop/Shell.test.tsx`                  | Bridge-only setup even with cached missing-key health data        |
| `apps/web/src/pages/ResumeFlow.test.tsx`               | Player exit updates cached Home/details progress                  |
| `apps/web/src/events/events.test.tsx`                  | Health latest-answer ordering, cancellation and reconnect         |
| `apps/web/src/desktop/MiniPlayer.test.tsx`             | Handoff, attached-session Retry and cleanup ownership             |
| `apps/web/src/desktop/MiniVolume.test.tsx`             | Volume/mute controls and values across both handoff directions    |
| `apps/web/src/components/NavSearch.test.tsx`           | One input, URL/history, typing, cancellation and phone expansion  |
| `apps/web/src/pages/SearchPage.test.tsx`               | Minimum length, debounce, Enter, local filtering and failures     |
| `apps/web/src/components/DetailsExtras.test.tsx`       | Row ordering/omission, cast initials and similar-title navigation |
| `apps/web/src/pages/ShowDetailsPage.spoilers.test.tsx` | Hidden DOM text, w92 stills, completion and loading progress      |
| `apps/web/src/lib/spoilers.test.ts`                    | Local persistence, storage events and blocked-storage fallback    |
| `apps/web/src/pages/SettingsPage.test.tsx`             | Hash tabs, keyboard/ARIA, device save and About separation        |
| `apps/web/src/notices/notices.test.tsx`                | Download outcomes and toast timing/actions                        |
| `apps/web/src/telemetry/turboEnv.test.ts`              | Build env declarations and disabled web build caching             |
| `apps/web/src/telemetry/buildEnv.test.ts`              | Build-time configuration, key-free test/off modes                 |

Other colocated tests cover Home/carousel, details, navigation, UUID fallback, shared responsive hooks and telemetry sanitization. Small fixtures are not proof of browser image scheduling or CSS hit-testing; those checks belong in Playwright.

The download-notice suite preloads the lazy Home, Settings and Player routes together in `beforeAll` in `apps/web/src/notices/notices.test.tsx`. This moves initial route/hls.js transformation before assertions instead of extending the normal one-second `findBy` timeout. It changes test setup, not production route loading.

`apps/web/src/pages/PlayerControls.test.tsx` asserts that all four arrows on the focused Volume range remain uncancelled and do not run global seek/volume actions. It also checks K/M on that input and arrows on the custom Seek slider. jsdom does not implement native range stepping; the browser spec below covers that behavior.

## Isolated browser flow

`apps/web/e2e/build.mjs` requires a built server and builds two UIs with explicit telemetry isolation. Each Vite child receives `{ ...process.env, ...env }`: the plain build overrides inherited web DSN, PostHog key/host, telemetry/stub switches, release-build switch, Sentry auth token, release and environment with empty strings. `apps/web/vite.config.ts` merges process variables after `.env`, so even a developer's configured environment cannot supply these values to **plain**. This is no-key isolation, not setting the telemetry switch to `off`. **Stub** starts from the same cleared values, then supplies loopback Sentry/PostHog settings, the stub-only deliberate-error trigger and the `e2e` Sentry environment. These are fixture-build settings, not changes to normal production telemetry defaults.

Before building, `apps/web/e2e/build.mjs` removes only `apps/web/reports/e2e-run`, clearing the prior fixture databases and their 10-minute TMDB cache. The navigation-search abort test waits for the exact outgoing slow request before replacing it, rather than assuming a 600 ms sleep was enough; it then checks the newest result and the old request's abort. It does not wait for the slow response (`apps/web/e2e/nav-search.spec.ts`). See [search test synchronization](search.md#modification-entry-points-and-tests).

Playwright starts a loopback hub and two real server processes. Servers have distinct data/transcode roots, nonexistent env-file paths, telemetry/mDNS off, random source-proxy ports and a **60 MB/s** download cap. `apps/web/e2e/ports.json` allocates **8602–8607**. One worker runs serially, with one retry in CI.

`apps/web/e2e/support/hub.mjs` supplies metadata/artwork, a gateway manifest with **empty stream lists**, telemetry collectors and feature-flag replies. Its TMDB fixture supports appended movie credits/show aggregate credits, recommendations/similar titles, season episodes, and image URLs with the real `/t/p/<size>/` shape. It includes `season/1` on show details only when requested in `append_to_response`, reusing the same fixture as the standalone season endpoint. `GET/DELETE /__requests` inspects/clears upstream request records; `POST/DELETE /__search-delays` controls slow-search fixtures. These are loopback test-hub endpoints, not production API routes.

`apps/web/e2e/details-api.spec.ts` requests show details followed by season one, checks for nonempty episodes and no standalone upstream season call, and requires any logged show-detail call to append `season/1`. An earlier test may already have cached the show, so this check permits zero new detail calls; server cache/fallback rules are documented under [catalog](../../features/catalog.md).

The Node fetch shim in `apps/web/e2e/support/redirect-fetch.mjs` redirects TMDB requests and refuses other non-loopback fetch destinations; it is a server-process fetch guard, not a general browser firewall. `apps/web/e2e/support/seed.ts` clears/writes progress and play-history rows in the **plain test server's database only**; serial execution prevents these fixtures from racing each other. `apps/web/e2e/support/desktopBridge.ts` installs a browser-side bridge double; it does not start Electron.

There are **11 specs**, assigned explicitly in `apps/web/playwright.config.ts`:

| Spec                                      | Project and boundary                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/web/e2e/smoke.spec.ts`              | Plain: built UI, request IDs, deep links, device registration, no-key behavior                            |
| `apps/web/e2e/resume.spec.ts`             | Plain: seeded progress/history, Continue Watching/removal; intercepted session POST positions             |
| `apps/web/e2e/player-input.spec.ts`       | Plain: fabricated/held session and HLS requests; real Chromium hit-testing of busy/error controls         |
| `apps/web/e2e/player-volume-keys.spec.ts` | Plain: native range arrow steps without seeking; global seek/volume arrows when focus is elsewhere        |
| `apps/web/e2e/details-api.spec.ts`        | Plain: real local API serialization, appended metadata and cache reuse against stub TMDB                  |
| `apps/web/e2e/details-cast.spec.ts`       | Plain: row order, empty/older payloads, initials, links, lazy images and viewport image budget            |
| `apps/web/e2e/nav-search.spec.ts`         | Plain: debounce, abort/newest answer, history, phone breakpoints, desktop-like drag regions and shortcuts |
| `apps/web/e2e/spoilers.spec.ts`           | Plain: local preference persistence, unfinished/completed episodes, DOM omission, still sizes and Up next |
| `apps/web/e2e/settings-tabs.spec.ts`      | Plain: hash startup/history, keyboard, styling and responsive About layout                                |
| `apps/web/e2e/settings-content.spec.ts`   | Plain: device save, control/fact separation, browser versus bridge-double content                         |
| `apps/web/e2e/telemetry.spec.ts`          | Telemetry: scrubbed local reports, template page views, opt-out and interval assignment                   |

**No browser spec starts a real server playback session, encoder or playable media stream.** Player-layout browser coverage exists, but these are not real HLS decode, GPU, upstream or Electron end-to-end playback tests.

The volume-key spec uses Chromium's real range defaults with browser-intercepted session responses and held HLS requests. It waits for each volume-driven slider render, checks **0.01** native steps, and counts media `currentTime` setter calls to detect unintended seeks. With focus elsewhere it expects two seek assignments and the global **0.05** volume step. Setter calls demonstrate shortcut dispatch, not successful media seeking.

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

Chromium must be installed separately. Keep new component tests offline, preserve explicit fixture environment isolation, and add budgets for new heavy chunks. Add each new browser spec to the appropriate project's explicit list in `apps/web/playwright.config.ts`; placing it in `apps/web/e2e/` alone does not select it. [Testing](../../how-to-contribute/testing.md) describes repository tiers; [web](index.md) maps the implementation.

## Key source files

| File                                      | Purpose                                                |
| ----------------------------------------- | ------------------------------------------------------ |
| `apps/web/vite.config.ts`                 | Proxy, lazy output, telemetry build config and Vitest  |
| `apps/web/vite.plugins.ts`                | Precompression and font preload                        |
| `apps/web/.size-limit.json`               | Asset ceilings                                         |
| `apps/web/src/bundleBudget.test.ts`       | Player ceiling and README consistency                  |
| `turbo.json`                              | Strict build environment declarations                  |
| `apps/web/turbo.json`                     | Web-only build cache override                          |
| `apps/web/src/telemetry/turboEnv.test.ts` | Build-variable and cache regression guards             |
| `apps/web/src/telemetry/buildEnv.ts`      | Key-free telemetry configuration for test/off builds   |
| `apps/web/coverage-thresholds.json`       | Coverage ratchet                                       |
| `apps/web/src/test/render.tsx`            | Fetch and provider test seams                          |
| `apps/web/src/test/fakeHls.ts`            | HLS controller double                                  |
| `apps/web/e2e/build.mjs`                  | Plain/stub build isolation                             |
| `apps/web/playwright.config.ts`           | Server lifecycle and browser projects                  |
| `apps/web/e2e/support/hub.mjs`            | Mock services and telemetry receivers                  |
| `apps/web/e2e/support/seed.ts`            | Shared isolated SQLite fixture writes                  |
| `apps/web/e2e/support/desktopBridge.ts`   | Browser-side desktop settings double                   |
| `apps/web/e2e/support/redirect-fetch.mjs` | Server fetch redirection/restriction                   |
| `apps/web/e2e/player-volume-keys.spec.ts` | Held-media Chromium range/shortcut regression          |
| `apps/web/e2e/details-api.spec.ts`        | Real local API and appended first-season stub coverage |

Committed web scope at `0b766e2`: **119 production files**, **49 unit/component test files**, **11 browser specs**, **60/119 = 0.50** test-to-source file ratio; unique human authors **1**. See [inventory method](index.md#measured-scope). No builds, application suites or live/GPU tests were run for this wiki update.
