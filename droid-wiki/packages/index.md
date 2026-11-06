# Packages

Active contributors: VeroxAUS

## Purpose

The repository has one internal workspace package, [shared](shared.md). It defines transport contracts and browser-safe privacy/telemetry primitives; network clients, persistence and encoders remain in the [server](../apps/server.md).

## Package boundary

`packages/shared/src/index.ts` exports runtime Zod schemas, inferred TypeScript types, constants, sanitizers, analytics definitions and feature-flag helpers. `packages/shared/package.json` exposes ESM JavaScript and declarations from the build output. It depends on Zod and has no application dependency.

The server imports `@homestream/shared`; the [web scaffold](../apps/web.md) declares it and uses a source alias during development/tests (`apps/server/package.json`, `apps/web/package.json`, `apps/web/vite.config.ts`). A declared dependency does not mean the placeholder UI already calls the API.

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

All `packages/` implementation belongs to `packages/shared`: **13 tracked production TypeScript source files**, **8 tracked test files**, **0.62 test-to-code file ratio**. Counts use `src/**/*.ts` and `test/**/*.test.ts`, excluding configs, helpers and outputs. Default-branch history has **1 unique human author**, VeroxAUS, excluding bots.
