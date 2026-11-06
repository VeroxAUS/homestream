# Applications
Active contributors: VeroxAUS

HomeStream has an implemented server and a placeholder browser app. The workspace entry for desktop is not an implementation: `apps/desktop` does not exist.

## Runtime map

| Application | Key abstraction and source | Status |
| --- | --- | --- |
| [Server](server.md) | Composition root, `apps/server/src/app.ts`; process entry, `apps/server/src/index.ts` | Fastify API, metadata, discovery, source proxy and playback |
| [Web](web.md) | React root, `apps/web/src/main.tsx`; placeholder, `apps/web/src/App.tsx` | Displays a heading and coming-soon text |
| Desktop | Workspace declaration, `pnpm-workspace.yaml` | Directory absent; no runtime or tests |

## Measured scope

Across `apps/`: **64 production TypeScript/TSX source files**, **38 test files**, **1 unique committer**. Server contributes 62 source / 37 tests; web contributes 2 source / 1 test. Counts use tracked files under `src/`, excluding `*.test.ts(x)`, and test files named `*.test.ts(x)` under each application; configuration, fixtures and helpers are excluded. Committers are distinct `git log --format="%cn <%ce>" -- apps` identities, not co-author trailers.

## Integration and modification

The server owns external-service access and media processing. Vite forwards `/api` and `/hls` during development; production server startup locates built web assets. No browser catalog, session controls, capability detection, or player is implemented yet. Extend server wiring in `apps/server/src/app.ts`, browser rendering in `apps/web/src/App.tsx`, and cross-boundary types in [shared contracts](../packages/shared.md).

See [architecture](../overview/architecture.md) for the runtime graph and [getting started](../overview/getting-started.md) for commands.
