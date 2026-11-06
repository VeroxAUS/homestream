# Packages
Active contributors: VeroxAUS

The repository currently contains one shared package. It defines transport contracts rather than a second service or a reusable media engine.

## Package map

| Package | Key abstraction and source | Consumers |
| --- | --- | --- |
| [Shared contracts](shared.md) | Export barrel, `packages/shared/src/index.ts`; runtime Zod schemas and inferred types | Server; declared web dependency |
| Build/export boundary | `packages/shared/package.json` | ESM JavaScript and declarations exported from `dist` |

## Integration and measurement

Put cross-runtime request/response shapes in `packages/shared/src/`, then export them through `packages/shared/src/index.ts`. Keep network clients, SQLite and encoding logic in the [server](../apps/server.md). The [web scaffold](../apps/web.md) has not yet implemented contract-driven interactions.

Measured `packages/` scope: **5 production TypeScript source files**, **3 test files**, **1 unique committer**; all belong to `packages/shared`. Counts use tracked `.ts` files under package `src/` and tracked `*.test.ts` under `test/`, excluding configuration and build output. Committers are distinct `%cn <%ce>` identities in Git history scoped to `packages`.
