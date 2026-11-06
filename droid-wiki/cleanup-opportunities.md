# Cleanup opportunities

This is an evidence-backed maintenance list at commit `7eb94bafed5e0e046987a81d0cbbff8e6ba999d1`, not an unrun scanner's dead-code or dependency-age report. The clearest opportunities are registered complexity exceptions and debt-document statements that no longer match the implemented browser (`eslint.config.mjs`, `docs/TECH_DEBT.md`, `apps/web/src/App.test.tsx`, `knip.jsonc`). See [contribution tooling](how-to-contribute/tooling.md).

## Registered complexity

Ordinary ceilings are cyclomatic **20**, cognitive **20**, and nesting depth **4**. These are the **configured per-file maxima**, not newly measured function scores. Blank cells mean the normal ceiling applies (`eslint.config.mjs`).

| File                                           | Cyclomatic ceiling | Cognitive ceiling | Depth exception | Area                              |
| ---------------------------------------------- | -----------------: | ----------------: | --------------: | --------------------------------- |
| `apps/server/src/config.ts`                    |                 29 |                   |                 | Env/default assembly              |
| `apps/server/src/health/checks/torbox.ts`      |                 27 |                22 |                 | Account-state handling            |
| `apps/server/src/playback/diskCap.ts`          |                 24 |                43 |                 | Park/resume planning              |
| `apps/server/src/playback/manager.ts`          |                 24 |                23 |                 | Start/fallback/seek orchestration |
| `apps/server/src/playback/probe.ts`            |                 31 |                22 |                 | ffprobe JSON parsing              |
| `apps/server/src/sourceproxy/serve.ts`         |                 34 |                61 |               5 | Streaming/backpressure/retries    |
| `apps/server/src/sourceproxy/sourceEntry.ts`   |                    |                22 |                 | Source-entry lifecycle            |
| `apps/server/test/playback/subtitleSources.ts` |                    |                36 |                 | Subtitle fixtures                 |
| `scripts/gpu-health.mjs`                       |                    |                23 |                 | GPU health gate                   |

Extract pure decision/parsing stages behind existing interfaces, test the seams, then remove the exception and its debt-register row. Do not raise ceilings or create new exceptions (`AGENTS.md`, `docs/TECH_DEBT.md`).

The streaming loop is explicitly identified as a hot path in `eslint.config.mjs`: benchmark before/after, retaining backpressure, retry, bounded memory and cleanup behavior. Playback orchestration changes must preserve ownership and failure cleanup, not just reduce a lint number. Use [source proxy](systems/source-proxy.md), [network controls](systems/network.md), [playback](systems/playback/index.md) and [debugging](how-to-contribute/debugging.md).

### Churn helps prioritize review, not justify rewrites

The completed [statistics](by-the-numbers.md) analysis records **2,073 added-plus-deleted lines across 20 commits** for `apps/server/src/playback/manager.ts`, the highest current-file churn in its HEAD-relative 90-day window. Only about two days of history exist; the window includes initial creation, formatting and moves. It is not a stable long-term trend or a bug count.

That overlap of an explicit complexity exception and recent change activity makes manager seams a reasonable review target. Source-proxy complexity is a separate registered concern; do not invent equally high churn for it. Test-file churn also reflects tier moves, not proof of flaky behavior.

## Correct stale debt-register statements

`docs/TECH_DEBT.md` still says the web app has “one placeholder test” and Knip ignores its shared dependency “until the first screen imports it.” Both descriptions are stale:

| Stale statement                                                             | Current evidence                                                                                                                                                                                                                                                                                          | Bounded follow-up                                                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Web has only a placeholder test/baseline                                    | `apps/web/src/App.test.tsx` exercises routes/Home content; `apps/web/src/pages/HomePage.test.tsx`, `apps/web/src/pages/SearchPage.test.tsx`, `apps/web/src/pages/MovieDetailsPage.test.tsx`, `apps/web/src/pages/ShowDetailsPage.test.tsx`, `apps/web/src/pages/SettingsPage.test.tsx` cover real screens | Replace the placeholder-era debt entry with current scope and actual remaining UI limits                       |
| Web shared dependency is ignored by Knip                                    | `knip.jsonc` has no web `ignoreDependencies`; `apps/web/src/api/queries.ts` imports shared schemas                                                                                                                                                                                                        | Remove the obsolete exception description, preserving the still-real script declaration ignore                 |
| Duplication discussion uses about 14,000 lines and claims no clones “today” | The dated [statistics](by-the-numbers.md) inventory has 58,241 tracked text lines under its own exclusions; that is not the jscpd denominator                                                                                                                                                             | Refresh the explanation from a scoped duplication run rather than carrying forward an undated zero-clone claim |
| Database prose says no stream URL is stored anywhere                        | `apps/server/src/gateway/cache.ts` serializes server-only streams; `apps/server/src/gateway/types.ts` includes `url`                                                                                                                                                                                      | Narrow `docs/database.md`'s guarantee to the appropriate records and explain sensitive local cache data        |

These are documentation follow-ups, not changes made by this wiki. The cache finding does not imply URLs reach clients or telemetry. See [data models](reference/data-models.md) and [security](security.md).

## Current coverage gates, not measured coverage

All percentages below are minimum configured thresholds. They do not report a newly run suite or establish the quality of uncovered behaviors.

| File                                       | Lines | Functions | Branches | Statements |
| ------------------------------------------ | ----: | --------: | -------: | ---------: |
| `apps/server/coverage-thresholds.json`     |    87 |        87 |       79 |         85 |
| `apps/web/coverage-thresholds.json`        |    95 |        98 |       89 |         95 |
| `apps/desktop/coverage-thresholds.json`    |    92 |        83 |       98 |         89 |
| `packages/shared/coverage-thresholds.json` |    98 |        98 |       98 |         98 |

The web player/dashboard placeholders are explicit feature scope, not evidence that the whole web package is untested (`apps/web/src/pages/PlayerPage.tsx`, `apps/web/src/App.test.tsx`). Desktop tests exercise support modules without launching Electron (`apps/desktop/README.md`). Treat implementation work and debt cleanup separately; see [web screens](apps/web/screens.md), [desktop](apps/desktop.md) and [testing](how-to-contribute/testing.md).

`pnpm coverage:ratchet` is a one-way tightening workflow, not permission to lower a gate (`scripts/coverage-ratchet.mjs`, `docs/TECH_DEBT.md`). GPU/live tiers remain intentionally separate from offline CI, not ordinary skipped tests to enable blindly (`AGENTS.md`).

## Guardrails for follow-up work

- TODO/FIXME/HACK budgets are zero (`techdebt.config.json`). Record a scoped issue/debt entry rather than adding an unowned marker.
- Knip's desktop `electron` ignore is explained by the absent shell start script; it does not establish that the planned runtime dependency is unwanted (`knip.jsonc`, `apps/desktop/src/index.ts`).
- Cache expiry is not guaranteed physical deletion: cache classes expose purge methods without a runtime scheduling call. Decide retention requirements before adding background work to a hot server (`apps/server/src/tmdb/cache.ts`, `apps/server/src/gateway/cache.ts`); see [data models](reference/data-models.md).
- No dependency freshness, vulnerability, dead-export or clone scan was run for this documentation task. Verify such findings with the relevant [tooling gate](how-to-contribute/tooling.md) before proposing removals; the [dependency inventory](reference/dependencies.md) is not an audit result.
