# Tooling

HomeStream uses pnpm workspaces, TypeScript ESM, ESLint, Vitest, tsx, and Vite. [Development workflow](development-workflow.md) explains their normal use; [dependencies](../reference/dependencies.md) lists direct declarations.

## Runtime and package management

Node 24.20.0 and pnpm 12.16.1 were observed in the documentation environment. These are observations, not repository pins: `package.json` declares neither `engines` nor `packageManager`. The server requires modern Node APIs including `node:sqlite` and `node:util.parseEnv`.

`pnpm-workspace.yaml` lists `apps/server`, `apps/web`, `apps/desktop`, and `packages/shared`. Only server, web, and shared exist. Its build allowlist mentions Electron-related packages and esbuild; this does not establish an implemented desktop application or installer.

`pnpm-lock.yaml` records dependency resolution. Root scripts in `package.json` recursively invoke `typecheck`, `lint`, `test`, and `build`.

## Compilation and development

`tsconfig.base.json` uses ES2023, NodeNext module resolution, strict checks, unchecked-index checks, isolated modules, and explicit override checks. Server builds compile source to `apps/server/dist` with source maps. Shared builds emit JavaScript, declarations, and source maps to `packages/shared/dist`.

The web config overrides module resolution to Bundler and enables React JSX and DOM types (`apps/web/tsconfig.json`). Its build runs no-emit typechecking followed by Vite. Server development uses tsx watch; production uses Node on compiled output.

## Static checks and tests

`eslint.config.mjs` combines recommended JavaScript/TypeScript rules, enforces type-only imports, and permits underscore-prefixed unused names. It ignores generated dist/release/coverage trees and supplies browser globals for web code. There are no custom lint plugins in this checkout.

`vitest.shared.ts` supplies shared aliases and timeouts. The server include pattern does not exclude live tests; read [testing](testing.md) before invoking the recursive script.

No checked-in CI workflow or QA configuration orchestrates these tools. Running a build is a local compilation step, not evidence of a release or deployment pipeline.
