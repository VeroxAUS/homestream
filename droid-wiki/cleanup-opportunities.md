# Cleanup opportunities

This is a source-backed maintenance list at `5eefa37`, not a new dead-code, dependency-age, security or performance audit. The main opportunities are registered exceptions and stale maintained prose. See [contribution tooling](how-to-contribute/tooling.md).

## Registered complexity

`eslint.config.mjs` sets ordinary ceilings of cyclomatic **20**, cognitive **20** and nesting depth **4**. The following are configured per-file exceptions, not scores measured during this wiki refresh.

| File | Cyclomatic | Cognitive | Depth |
| --- | ---: | ---: | ---: |
| `apps/server/src/config.ts` | 29 | — | — |
| `apps/server/src/health/checks/torbox.ts` | 27 | 22 | — |
| `apps/server/src/playback/diskCap.ts` | 24 | 43 | — |
| `apps/server/src/playback/probe.ts` | 31 | 22 | — |
| `apps/server/src/sourceproxy/serve.ts` | 34 | 61 | 5 |
| `apps/server/src/sourceproxy/sourceEntry.ts` | — | 22 | — |
| `apps/server/test/playback/subtitleSources.ts` | — | 36 | — |

The old playback-manager and GPU-health exceptions are gone. `PlaybackManager` in `apps/server/src/playback/manager.ts` is now a facade over smaller lifecycle/start/serving modules; do not carry its former complexity ceiling into new work.

Extract pure parsing/decision stages behind existing interfaces, preserve ownership/cleanup, test seams and remove paid-off exceptions. The proxy streaming loop is a hot path: retain backpressure, bounded memory and retries, and benchmark before/after any refactor. This documentation task performed no benchmark. See [source proxy](systems/source-proxy.md) and [playback](systems/playback/index.md).

Use the dated methodology in [by the numbers](by-the-numbers.md) for churn prioritization. Creation, file moves and formatting can dominate recent history; churn is neither a defect count nor justification for a rewrite.

## Line limits only shrink

`limitConfigBlocks` in `scripts/lib/code-limits.mjs` integrates the **400-line file / 80-line function** rules with ESLint. Blank lines/comments do not count. Tests are exempt from the function ceiling only, not the file ceiling.

`code-limits.baseline.json` records grandfathered over-limit sizes. `scripts/code-limits.mjs` requires entries to equal measured size, removes obsolete entries and prevents additions/increases relative to the previous main baseline. Lower ceilings with `node scripts/code-limits.mjs --write`; split code instead of raising them. This is a maintenance ratchet, not permission to create new giant modules.

## Correct stale maintained documentation

These follow-ups concern source documentation outside this generated wiki; no changes to those files are made here.

| File/claim | Current evidence | Bounded follow-up |
| --- | --- | --- |
| `docs/TECH_DEBT.md`: web has one placeholder test | Real route, catalog, settings and player tests exist under `apps/web/src/` | Replace placeholder-era coverage prose with actual remaining gaps |
| `docs/TECH_DEBT.md`: Knip ignores web's shared dependency until first use | `knip.jsonc` no longer has that web ignore; shared schemas are imported by real screens/API code | Remove obsolete exception description |
| `docs/TECH_DEBT.md`: undated zero clones and old size denominator | A configured duplication gate is not a newly run result | Refresh only from a scoped duplication run |
| `README.md`: player/desktop status | `apps/web/src/player/` and `apps/desktop/src/main.ts` implement playback and shell behavior | Update status without claiming a shipped installer or TV app |
| `docs/database.md`: no stream URL stored anywhere | `apps/server/src/gateway/cache.ts` serializes server streams containing `url` from `apps/server/src/gateway/types.ts` | Narrow guarantee and document sensitive cache/backups |

The database discrepancy does not imply raw source URLs reach public stream options or telemetry. See [data models](reference/data-models.md) and [security](security.md).

## Verification and scope

Coverage thresholds are configured minima, not measured current coverage; `pnpm coverage:ratchet` only tightens them (`scripts/coverage-ratchet.mjs`). A high percentage does not establish that races, resource bounds or GPU behavior are covered.

Dashboard placeholders and absent TV source are feature scope, not evidence that the working player/shell are skeletons. Desktop unit tests do not launch Electron; its separate smoke tier does. GPU/live tiers deliberately require separate machinery and keys. See [testing](how-to-contribute/testing.md), [web player](apps/web/player.md) and [desktop](apps/desktop/index.md).

Cache expiry and physical row deletion are separate policies; inspect runtime scheduling before assuming purge methods run periodically (`apps/server/src/tmdb/cache.ts`, `apps/server/src/gateway/cache.ts`). Any retention change needs an explicit requirement and must avoid adding heavy work to playback.

No test suite, scanner, dependency-freshness research or live account inspection was run for this page. Confirm proposed dead-code, clone or vulnerability findings with the relevant gate before removing code or changing dependencies.
