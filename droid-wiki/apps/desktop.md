# Desktop

Active contributors: VeroxAUS

## Purpose

`@homestream/desktop` contains tested support modules for a future Electron 45 shell. It does **not** currently create a window, tray, preload, server supervisor or application lifecycle; `apps/desktop/src/index.ts` only re-exports utilities. The future shell is intended to load the [web UI](web/index.md) from the [server](server.md), not import either app's implementation.

## Directory layout

```text
apps/desktop/
├── src/index.ts                     # public exports, not a shell bootstrap
├── src/logger.ts                    # injected JSON-lines sink
├── src/requestId.ts                 # UUID request headers
├── src/telemetry/
│   ├── config.ts                    # pure environment resolution
│   ├── sentry.ts                    # main SDK option builder
│   ├── scrub.ts                     # identity and shared sanitization
│   └── analytics.ts                 # optional typed PostHog wrapper
├── test/logger.test.ts
├── test/telemetryConfig.test.ts
├── test/integration/telemetryWiring.test.ts
├── vitest.config.ts
└── tsconfig.build.json
```

## Key abstractions and flow

| Abstraction              | Source                                    | Role                                                               |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------------ |
| `createLogger`           | `apps/desktop/src/logger.ts`              | Injected scrubber/sink/clock, JSON lines and optional breadcrumbs  |
| `withRequestId`          | `apps/desktop/src/requestId.ts`           | Caller headers plus UUID `X-Request-ID`                            |
| `resolveTelemetryConfig` | `apps/desktop/src/telemetry/config.ts`    | Optional clients, normalized PostHog origin and environment        |
| `createMainScrubber`     | `apps/desktop/src/telemetry/scrub.ts`     | Shared sanitizer plus machine/user identity and installation roots |
| `buildMainSentryOptions` | `apps/desktop/src/telemetry/sentry.ts`    | Options or `null`; does not invoke `Sentry.init`                   |
| `createDesktopAnalytics` | `apps/desktop/src/telemetry/analytics.ts` | Optional safe capture/shutdown facade                              |

The logger writes `{level,time,msg,...fields}` with one newline. It scrubs messages, direct string fields and Error messages; arbitrary nested objects are not recursively sanitized by this logger. Supply small known-safe fields and the actual scrubber, rather than assuming every injected sink is privacy-safe. Debug is written but not forwarded to breadcrumbs. Sink/breadcrumb failures inside the write block are swallowed (`apps/desktop/src/logger.ts`).

`withRequestId` adds a header but performs no request. Configuration resolution reads an already-populated environment; it does not load a file. It accepts the web Sentry DSN, not the server DSN; default environment is development unless packaged, and default PostHog host is `https://us.i.posthog.com` (`apps/desktop/src/requestId.ts`, `apps/desktop/src/telemetry/config.ts`). Full outbound behavior belongs to [telemetry](../systems/telemetry.md).

## Planned shell wiring

The sequence in `apps/desktop/README.md` is a plan, not executed code:

1. Load development or packaged configuration, then resolve it using `app.isPackaged`.
2. Create scrubbers and call `Sentry.init` with the built main-process options **before** `app.whenReady()`.
3. Connect a local log sink and breadcrumbs; route shell server requests through the request-ID helper.
4. Create the window, then initialize optional analytics off the visible startup path and emit `desktop_started`.
5. Persist a random analytics installation ID in user data and shut the analytics client down on quit.

There is no implemented ID persistence, window creation or startup-event call site in this package. The renderer already recognizes an optional `window.homestream.isDesktop` marker, but the preload that would expose it remains unwritten (`apps/web/src/env.d.ts`, `apps/web/src/device/identity.ts`). Main Sentry options target the web project with `app=desktop`, `process=main`, `device.kind=desktop`; the renderer retains its own web scrubber rather than an Electron renderer integration (`apps/desktop/src/telemetry/sentry.ts`, `apps/desktop/README.md`).

## Build, tests and modification points

`apps/desktop/package.json` pins Electron `~45.2.3`; its build first builds shared contracts and then emits TypeScript to `apps/desktop/dist`. The `main` field resolves to the export module, not a working desktop entry. There is no launch/package script yet.

```sh
pnpm --filter @homestream/desktop typecheck
pnpm --filter @homestream/desktop test
pnpm --filter @homestream/desktop test:coverage
pnpm --filter @homestream/desktop build
pnpm --filter @homestream/desktop size
```

Vitest runs plain Node tests through `apps/desktop/vitest.config.ts`; no Electron binary is launched. The integration test composes modules with mocked PostHog, validating null clients, tags, hostile payload scrubbing, empty geo handling, catalog restrictions and failure swallowing (`apps/desktop/test/integration/telemetryWiring.test.ts`). The 100 kB gzip ceiling covers emitted main-process JS (`apps/desktop/.size-limit.json`). Coverage thresholds are **92% lines, 83% functions, 98% branches and 89% statements** (`apps/desktop/coverage-thresholds.json`), not newly measured results.

Start future shell work at a real bootstrap/lifecycle boundary, with injected Electron/network seams. Preserve support-module testability and the app dependency boundary; do not imply supervisor coverage from the existing telemetry integration test. See [testing](../how-to-contribute/testing.md) and [architecture](../overview/architecture.md).

## Key source files

| File                                                    | Purpose                                      |
| ------------------------------------------------------- | -------------------------------------------- |
| `apps/desktop/src/index.ts`                             | Utility exports and current entry limitation |
| `apps/desktop/src/logger.ts`                            | JSON-lines logger with injected dependencies |
| `apps/desktop/src/requestId.ts`                         | Header correlation helper                    |
| `apps/desktop/src/telemetry/config.ts`                  | Environment parsing and master switch        |
| `apps/desktop/src/telemetry/sentry.ts`                  | Main-process Sentry options                  |
| `apps/desktop/src/telemetry/scrub.ts`                   | Machine/user and shared payload scrubber     |
| `apps/desktop/src/telemetry/analytics.ts`               | Catalog-only analytics client                |
| `apps/desktop/test/integration/telemetryWiring.test.ts` | Stubbed multi-module checks                  |
| `apps/desktop/README.md`                                | Future shell wiring sequence                 |

## Measured scope

Tracked `apps/desktop/src/` has **7 production TypeScript files** and `apps/desktop/test/` has **3 test files**, a **0.43 test-to-code file ratio**. They contain 261 and 255 physical lines respectively; configuration/build outputs are excluded. Default-branch history has **1 unique human author**, VeroxAUS. No Electron process or test suite was run for this documentation.
