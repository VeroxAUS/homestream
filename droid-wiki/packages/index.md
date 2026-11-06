# Packages

Active contributors: VeroxAUS

## Purpose

The repository has one internal workspace package, [shared](shared.md). It defines transport contracts and browser-safe privacy/telemetry primitives; network clients, persistence and encoders remain in the [server](../apps/server.md).

## Package boundary

`packages/shared/src/index.ts` exports runtime Zod schemas, inferred TypeScript types, constants, sanitizers, analytics definitions and feature-flag helpers. `packages/shared/package.json` exposes ESM JavaScript and declarations from the build output. It depends on Zod and has no application dependency.

The [server](../apps/server.md), implemented [web UI](../apps/web/index.md) and [desktop support modules](../apps/desktop.md) import `@homestream/shared`. Vite uses a source alias during development; the library's package export targets compiled JavaScript and declarations (`apps/server/package.json`, `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/desktop/package.json`). These are four workspaces total, but only one resides under `packages/` (`pnpm-workspace.yaml`).

For schema families, analytics/device identity distinctions, sanitizers, active flags and contract tests, read [Shared](shared.md). The package has no HTTP client, database connection or telemetry SDK; consumers supply those runtime effects.

## Modification entry points

Put cross-runtime shapes and pure shared policy in `packages/shared/src/`, then export them through `packages/shared/src/index.ts`. Keep filesystem, Node-only process code and upstream credentials out of this package. Schema changes must remain aligned with consumers and the [API](../api/index.md).

## Key source files

| File                                  | Purpose                                   |
| ------------------------------------- | ----------------------------------------- |
| `pnpm-workspace.yaml`                 | Workspace membership                      |
| `packages/shared/package.json`        | ESM/declaration export and build boundary |
| `packages/shared/src/index.ts`        | Public export surface                     |
| `packages/shared/tsconfig.build.json` | Library compilation                       |
| `packages/shared/vitest.config.ts`    | Shared-package tests and coverage         |

## Measured scope

All `packages/` implementation belongs to `packages/shared`: **14 tracked production TypeScript source files**, **9 tracked test files**, **0.64 test-to-code file ratio** (test files divided by source files). Counts use `packages/shared/src/**/*.ts` and `packages/shared/test/**/*.test.ts`, include the export barrel, and exclude configs and outputs. Default-branch history has **1 unique human committer**, VeroxAUS, excluding bots.
