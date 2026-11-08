# Web bundle budget exceeded

## Symptoms

- CI fails in the step **Bundle budgets** with `Size limit` and a size above the limit for `Initial JavaScript`, `Player chunk` or `Telemetry chunk`.
- `pnpm --filter @homestream/web size` exits non-zero.

## Diagnosis

1. Build and open the treemap of the bundle: `pnpm --filter @homestream/web analyze` writes `apps/web/reports/bundle.html`.
2. Compare with the budget in `apps/web/.size-limit.json` (gzip sizes): initial JavaScript 150 kB, player chunk 200 kB (full hls.js is needed for subtitles; the chunk loads only on Play), telemetry chunk 100 kB.
3. Find the module that grew. Typical causes: a heavy library imported at the top of a route instead of lazily, `posthog-js` imported from its full entry instead of the slim one (`posthog-js/dist/module.slim`), or Sentry or PostHog code imported from `src/telemetry/index.ts` (it must stay free of both).

## Fix

- Load heavy code lazily (`React.lazy` or a dynamic `import()`) and give the new chunk an entry in `.size-limit.json` with its own limit.
- Import only what is used (named imports from a library with a small entry point).
- Raise a limit only with a reason in the commit message; the design budgets are the target, not the CI limit.

## Verify

```powershell
pnpm --filter @homestream/web build
pnpm --filter @homestream/web size
```
