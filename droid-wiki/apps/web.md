# Web

Active contributors: VeroxAUS

## Purpose

`@homestream/web` is a React 19/Vite scaffold, not a working media client. Its only screen says “HomeStream” and “The web UI is coming soon” (`apps/web/src/App.tsx`).

## Mount and development flow

`apps/web/index.html` provides the root element. `apps/web/src/main.tsx` requires that element and mounts `App` inside React StrictMode. `apps/web/src/App.tsx` renders an inline-styled heading and paragraph; it makes no API calls.

`apps/web/vite.config.ts` enables the React plugin, aliases shared contracts to source for development/tests, listens on port **8601**, and proxies `/api` and `/hls` to the server at port **8600**. Production output goes to `apps/web/dist`, which the [server](server.md) can serve.

There is no implemented router, state store, device/capability detection, browser player, session controls, telemetry initialization or feature-flag consumer. The planned banner experiment in `packages/shared/src/flags.ts` is not a browser carousel implementation.

## Modification entry points

Begin screen work in `apps/web/src/App.tsx`; change mounting in `apps/web/src/main.tsx` and proxy/build settings in `apps/web/vite.config.ts`. Consult [shared contracts](../packages/shared.md) and [API](../api/index.md) before adding requests. The manifest declares shared, React and React DOM, with scripts for development, build, types, lint, tests and coverage (`apps/web/package.json`).

## Key source files

| File                        | Purpose                                   |
| --------------------------- | ----------------------------------------- |
| `apps/web/index.html`       | HTML host                                 |
| `apps/web/src/main.tsx`     | React root and StrictMode                 |
| `apps/web/src/App.tsx`      | Placeholder screen                        |
| `apps/web/vite.config.ts`   | Proxy, build and Vitest configuration     |
| `apps/web/package.json`     | Scripts and dependencies                  |
| `apps/web/src/App.test.tsx` | Server-render smoke check for the heading |

## Measured scope

Tracked `apps/web/src/` contains **2 production TSX files** and **1 test file**, a **0.50 test-to-code file ratio**. Configs/build outputs are excluded. Default-branch history has **1 unique human author**, VeroxAUS, excluding bots. The existing test checks rendered text, not browser navigation or playback.
