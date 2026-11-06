# Web placeholder
Active contributors: VeroxAUS

`@homestream/web` is a React/Vite scaffold, not an implemented catalog or playback client. Its only UI is “HomeStream” and “The web UI is coming soon.”

## Key abstractions

| Element | Source | Current behavior |
| --- | --- | --- |
| HTML host | `apps/web/index.html` | Supplies the root element |
| React entry | `apps/web/src/main.tsx` | Mounts `App` in StrictMode; fails if `#root` is missing |
| App | `apps/web/src/App.tsx` | Inline-styled heading and placeholder paragraph |
| Development/build configuration | `apps/web/vite.config.ts` | React plugin, shared source alias, proxy, Vitest settings |
| Render check | `apps/web/src/App.test.tsx` | Server-renders App and checks for “HomeStream” |

## Development and integration

`apps/web/package.json` exposes Vite development, TypeScript/Vite build, typecheck, lint and Vitest commands. Vite listens on port 8601 and forwards `/api` and `/hls` to `127.0.0.1:8600`; builds go to `apps/web/dist`. The [server](server.md) can serve those assets.

The dependency on `@homestream/shared` and the development alias enable future contract reuse; `App` currently makes no API requests. No routing, state store, device registration/capability probing, media controls, or HLS player exists. Device kinds in the contracts do not prove that desktop or TV apps exist.

## Modification and measurement

Begin UI changes in `apps/web/src/App.tsx`; change mounting in `apps/web/src/main.tsx`, and development proxy/build behavior in `apps/web/vite.config.ts`. Consult [shared contracts](../packages/shared.md) before adding API calls.

Measured `apps/web` scope: **2 production TSX source files**, **1 test file**, **1 unique committer**. Counts use tracked files under `apps/web/src/`, separating `*.test.tsx` from production files and excluding configuration. Committers are distinct `%cn <%ce>` identities in Git history scoped to `apps/web`. The existing test is a render smoke check, not browser or playback coverage.
