# Development workflow

HomeStream develops as three present pnpm workspaces: server, web, and shared contracts. Commands below run from the repository root; see [tooling](tooling.md) for their definitions.

## Prepare and run

```powershell
pnpm install
pnpm --filter @homestream/shared build
```

Provide your own local configuration using [configuration](../reference/configuration.md). Never copy real tokens into tracked examples. Use separate terminals for:

```powershell
pnpm --filter @homestream/server dev
pnpm --filter @homestream/web dev
```

`apps/server/package.json` uses `tsx watch src/index.ts`. `apps/web/vite.config.ts` serves development UI on port 8601 and proxies `/api` and `/hls` to port 8600. Changing the server port also requires adjusting how the development client reaches it; the proxy target is not derived from server configuration.

## Make a focused change

Inspect the current diff first and preserve unrelated work. Update shared schemas when changing an HTTP contract, then update routes, service logic, and tests together. Server runtime imports resolve `@homestream/shared` through its built `dist` export, so rebuild shared after changing contracts; test aliases may otherwise hide stale runtime output.

Use `AppError` for expected failures and retain explicit close ownership in `apps/server/src/app.ts`. For database changes, append a numbered migration rather than editing already-applied SQL.

## Validate and hand off

```powershell
pnpm typecheck
pnpm lint
pnpm build
```

Choose test commands using [testing](testing.md), not an assumed offline root test run. `pnpm test` includes live requests and hardware-dependent cases.

Review the resulting diff for generated assets, credentials, and accidental scope changes. Include the behavior changed and verification limitations in the handoff. There is no checked-in PR template, CI deployment pipeline, or mandatory branch/approval policy to document as an enforced workflow.
