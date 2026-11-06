# Testing

Vitest separates offline unit/integration coverage from real encodes and upstream calls. The safe all-workspace default is `pnpm test:ci`, not `pnpm test` (`package.json`, `apps/server/vitest.config.ts`).

## Choose a tier

| Tier        | Root command            | Server scope                                                  | Requirements                                  |
| ----------- | ----------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| Unit        | `pnpm test:unit`        | `apps/server/test/**/*.test.ts`, excluding the other projects | No external services, GPU or keys             |
| Integration | `pnpm test:integration` | `apps/server/test/integration/`                               | Fastify injection, local stubs, fake encoders |
| GPU         | `pnpm test:gpu`         | `apps/server/test/encode/`                                    | FFmpeg/ffprobe, NVENC and NVIDIA driver       |
| Live        | `pnpm test:live`        | `apps/server/test/live/`                                      | Real TMDB/gateway configuration and network   |

The root unit/integration commands select the server only. `pnpm test:ci` uses Turbo to run server unit + integration and the web/shared tests. `pnpm test:coverage` runs package coverage sequentially and excludes the server GPU/live projects. Plain server `vitest run`, and therefore root `pnpm test`, selects all four projects (`apps/server/package.json`, `turbo.json`).

```powershell
pnpm test:ci
pnpm test:coverage
pnpm --filter @homestream/server exec vitest run --project unit test/net.test.ts
pnpm --filter @homestream/server exec vitest run --project integration test/integration/progress-routes.test.ts
pnpm --filter @homestream/shared test
```

Web tests live beside source as `*.test.ts`/`*.test.tsx`; shared tests live in `packages/shared/test/` (`apps/web/vite.config.ts`, `packages/shared/vitest.config.ts`). The current web test renders the placeholder to a string, not a browser or remote-control flow (`apps/web/src/App.test.tsx`).

## Isolation and fake seams

`makeTempDir`, `testConfig` and `startTestApp` in `apps/server/test/helpers.ts` provide a unique directory, invented configuration, port 0 and a silent logger. `HOMESTREAM_TEST_ROOT` overrides the Windows-oriented default; CI and the dev container set it to their temporary storage. On Linux, set it explicitly when running tests locally.

`buildApp` in `apps/server/src/app.ts` accepts database, TMDB/gateway, bus and telemetry instances plus probe/resolver, encoder factory, health command/fetch, clocks, timeouts and resource limits. Use these seams rather than real upstreams in offline tests.

| Helper/example                                           | What it replaces or demonstrates                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/server/test/gateway/stubGateway.ts`                | Loopback HTTP server on port 0 with configurable replies, delays and request capture |
| `apps/server/test/tmdb/fixtures.ts`                      | Fake TMDB responses                                                                  |
| `apps/server/test/playback/fakeEncoder.ts`               | First-segment success, immediate failure or a hung encoder without a subprocess      |
| `apps/server/test/playback/harness.ts`                   | Composed app/stub gateway; real probe/encode by default unless replaced              |
| `apps/server/test/integration/playback-fallback.test.ts` | Injected probe and fake encoders; validates fallback and absence of residue          |
| `apps/server/test/integration/openapi.test.ts`           | Route documentation and shared contract checks                                       |

Use `app.inject` for handlers. The reusable playback harness alone does **not** imply an offline test: its media-generation helpers start real encoders. Close harnesses/apps in teardown, close caller-owned database/gateway/telemetry resources, await background work, clear global/environment changes, and remove temp directories only after handles close. New tests must not share ports, files or clocks (`AGENTS.md`).

`apps/server/test/telemetryEnv.ts` removes inherited telemetry keys before server tests. Keep fixtures invented even when the production path contains secret-shaped data; never copy a real gateway/CDN response into a test.

## Coverage and reports

V8 coverage uses package-local thresholds, not just a global percentage:

| Threshold file                             | Lines | Functions | Branches | Statements |
| ------------------------------------------ | ----: | --------: | -------: | ---------: |
| `apps/server/coverage-thresholds.json`     |    87 |        87 |       79 |         85 |
| `packages/shared/coverage-thresholds.json` |    98 |        98 |       98 |         98 |
| `apps/web/coverage-thresholds.json`        |    23 |        98 |        0 |         18 |

These are minimum percentages, not newly measured coverage. `scripts/coverage-ratchet.mjs` measures coverage and can raise thresholds to the floored measured percentage minus two points; it never lowers them. `pnpm coverage:ratchet --check --no-run` reviews existing summaries without writing thresholds or rerunning suites.

`vitest.shared.ts` caps workers at `min(8, availableParallelism())` and sets 20-second test/hook defaults. Under CI, failed cases retry twice and write `junit.xml`, `vitest.json` and `flaky.json` under `reports/<package>/`; ordinary local runs do not retry.

```powershell
pnpm test:report
pnpm test:flaky-report
pnpm test:timing
pnpm ci:summary
```

`scripts/test-report.mjs` runs offline package tests in CI mode and merges reports; `--merge-only` reuses reports from a previous run. Coverage summaries live under each package's `coverage/`. Linux CI uploads merged reports and summaries for 14 days (`.github/workflows/ci.yml`). A pass after retry is still a defect to investigate; follow `docs/runbooks/flaky-tests.md`, not a larger retry count.

## GPU and live safety

Follow `.factory/skills/homestream-live-tests/SKILL.md` before real-world verification. Run one file at a time on an idle machine, never alongside a game or another heavy encode:

```powershell
pnpm --filter @homestream/server exec vitest run --project gpu test/encode/hls-encode.test.ts
pnpm --filter @homestream/server exec vitest run --project live test/live/streams.live.test.ts
```

The GPU project disables file parallelism and uses one worker, a 60-second test default and a 180-second hook default (`apps/server/test/gpuGroups.ts`). `apps/server/test/hasNvenc.ts` gates hardware-dependent suites. `apps/server/test/gpuSetup.ts` and `apps/server/test/gpuCleanup.ts` clean child processes after failures and worker exit; this does not replace gentle session shutdown.

The optional Windows gate in `scripts/gpu-health.mjs` requires `--since <ISO-time>`, fails closed on unreadable GPU/event state, rejects new driver events, temperature above 83°C or less than 4 GiB free RAM by default. `--require-idle` also checks sustained/bursty utilization. It is not an automatic CI prerequisite.

Live TMDB cases skip without `TMDB_READ_TOKEN`; gateway cases skip without both required keys (`apps/server/test/live/tmdb.live.test.ts`, `apps/server/test/live/streams.live.test.ts`). Keep requests few: the gateway allows about five per five seconds. For manual real-title checks, set `MAX_DOWNLOAD_MBPS=60` or lower and never download whole files.

Manual servers use ports 8600–8699; automated tests use port 0. End test sessions with `DELETE /api/sessions/:id` without body/content-type, then stop owned server processes by PID and verify no FFmpeg remains. Report skipped tiers as skipped, not as playback validation. See [debugging](debugging.md) and [playback](../systems/playback/index.md).
