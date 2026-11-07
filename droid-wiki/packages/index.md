# Packages

Active contributors: VeroxAUS

## Purpose

The repository has one internal package, [shared](shared.md), consumed by the [server](../apps/server.md), [web UI](../apps/web/index.md) and working [desktop shell](../apps/desktop/index.md). It holds cross-runtime contracts and pure policy, not application services.

## Layout and boundary

| Path | Responsibility |
| --- | --- |
| `packages/shared/src/index.ts` | Public barrel for schemas, inferred types, desktop bridge and pure helpers |
| `packages/shared/src/` | Fourteen implementation modules plus the barrel |
| `packages/shared/test/` | Offline contract, privacy and policy tests |
| `packages/shared/package.json` | ESM runtime/declaration exports and Zod dependency |

`@homestream/shared` imports resolve to compiled JavaScript and declarations through `packages/shared/package.json`. Source aliases in Vite/Vitest allow development and tests against source; aliases do not replace the library's published export boundary. There are four application/package workspaces in `pnpm-workspace.yaml`, but only shared lives under `packages/`.

The package has no HTTP client, SQLite connection, Electron runtime or telemetry SDK. Types describe transport shapes; consumers still choose where runtime validation occurs. Typed event/flag definitions are not telemetry initialization: see [telemetry](../systems/telemetry.md).

## How to modify

Add cross-runtime schemas or pure rules in `packages/shared/src/`, export additions through `packages/shared/src/index.ts`, and extend tests and affected consumers together. Desktop IPC types live here, but privileged implementation remains in the desktop app. Keep filesystem/process operations, upstream secrets and runtime SDKs out.

HTTP contract changes also require route documentation and generated OpenAPI updates; see [API](../api/index.md). Full module families, semantic distinctions and testing entry points are in [Shared contracts](shared.md).

## Key source files

| File | Purpose |
| --- | --- |
| `pnpm-workspace.yaml` | Workspace membership |
| `packages/shared/package.json` | Root ESM/declaration export |
| `packages/shared/src/index.ts` | Public import surface |
| `packages/shared/tsconfig.build.json` | Compilation boundary |
| `packages/shared/vitest.config.ts` | Offline tests and coverage settings |

## Measured scope

At `5eefa37`, `git ls-tree -r --name-only origin/main` yields **15 production `.ts` files** under `packages/shared/src/` and **10 `.test.ts` files** under `packages/shared/test/`, including the barrel and excluding configs/outputs. Test/source file ratio: **0.67**. Scoped `git log origin/main --format='%an' -- packages/shared` has **1 unique human author**, VeroxAUS, matching CODEOWNERS. Counts are not coverage or execution results.
