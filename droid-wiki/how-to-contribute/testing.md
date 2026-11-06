# Testing

Vitest covers contracts, routes, upstream adapters, caching, playback, and real encoding. The complete suite is not an offline unit suite. Read this page before running `pnpm test`; see [debugging](debugging.md) for failures.

## Configuration and scope

`package.json` runs tests recursively. `apps/server/vitest.config.ts` includes every `test/**/*.test.ts`, including `test/live/`; there is no opt-in exclusion. `vitest.shared.ts` sets eight workers and 20-second test/hook defaults. Individual encoding/live cases raise timeouts.

Server and web test configs alias `@homestream/shared` directly to `packages/shared/src/index.ts`. Shared tests use `packages/shared/vitest.config.ts`; web tests match `src/**/*.test.{ts,tsx}` through `apps/web/vite.config.ts`.

## Select a bounded check

Examples from the repository root:

```powershell
pnpm --filter @homestream/shared test
pnpm --filter @homestream/server exec vitest run test/config.test.ts test/db.test.ts test/events.test.ts
pnpm --filter @homestream/server exec vitest run test/streams/rank.test.ts test/streams/parse.test.ts
```

These are targeted checks, not substitutes for real encoding validation. Inspect a test's setup before assuming any broader directory is hardware-free.

## External and platform requirements

`apps/server/test/live/tmdb.live.test.ts` explicitly requires a configured TMDB token: its token assertion fails when absent. It does not simply skip. `apps/server/test/live/streams.live.test.ts` skips its cases if gateway/TMDB configuration is missing. Both construct configuration using repository discovery and may make real upstream requests.

`apps/server/test/playback/harness.ts` generates local media with FFmpeg, including `hevc_nvenc`, and probes encoded output with ffprobe. Encode tests exercise HDR, tone mapping, segment alignment, seeking, track changes, and process cleanup. They require a suitable FFmpeg build and NVIDIA hardware/driver support, not just an executable on PATH.

`apps/server/test/helpers.ts` uses `D:\HomeStream\test-tmp`. Harness process inspection invokes `powershell.exe` and `Get-CimInstance Win32_Process`. These are Windows-specific assumptions.

Use injected services, stub gateways/CDNs, and app cleanup for new deterministic coverage. Explicitly report live, GPU, and platform checks left unrun; documentation generation itself does not establish that application tests passed.
