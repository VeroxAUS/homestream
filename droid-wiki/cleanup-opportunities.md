# Cleanup opportunities

This is a bounded list of registered complexity and coverage debt, not an unverified dead-code or dependency-freshness report. `docs/TECH_DEBT.md`, `eslint.config.mjs` and package threshold files are the source of truth.

## Registered complexity

The normal ceilings are cyclomatic 20, cognitive 20 and nesting depth 4. The following are **per-file configured maxima** for legacy code, not new measurements taken for this wiki (`eslint.config.mjs`). A blank cell means the ordinary limit applies.

| File                                           | Cyclomatic ceiling | Cognitive ceiling | Depth exception | Recorded area                             |
| ---------------------------------------------- | -----------------: | ----------------: | --------------: | ----------------------------------------- |
| `apps/server/src/config.ts`                    |                 29 |                   |                 | Environment/default assembly              |
| `apps/server/src/health/checks/torbox.ts`      |                 27 |                22 |                 | TorBox account states                     |
| `apps/server/src/playback/diskCap.ts`          |                 24 |                43 |                 | Transcode parking/resume plan             |
| `apps/server/src/playback/manager.ts`          |                 24 |                23 |                 | Session start/fallback/seek orchestration |
| `apps/server/src/playback/probe.ts`            |                 31 |                22 |                 | FFprobe JSON parsing                      |
| `apps/server/src/sourceproxy/serve.ts`         |                 34 |                61 |               5 | Streaming, backpressure and retry loop    |
| `apps/server/src/sourceproxy/sourceEntry.ts`   |                    |                22 |                 | Source-entry lifecycle method             |
| `apps/server/test/playback/subtitleSources.ts` |                    |                36 |                 | Generated subtitle fixtures               |
| `scripts/gpu-health.mjs`                       |                    |                23 |                 | GPU health gate                           |

Good cleanup extracts pure decisions or parsing stages behind existing interfaces, adds focused tests, and removes the exception once the file fits the normal ceiling. Do not simply raise limits or move branches into an equally opaque helper.

The source proxy loop is a hot path: benchmark before and after, including backpressure/retry behavior, and retain bounded memory and cleanup. Playback refactors must preserve reservation accounting, source leases and failed-attempt cleanup. Follow [source proxy](systems/source-proxy.md), [network controls](systems/network.md), [playback](systems/playback/index.md), and [profiling guidance](how-to-contribute/debugging.md).

For current historical churn context, use [by the numbers](by-the-numbers.md); size or churn alone is not a bug or permission to rewrite a stable path.

## Coverage debt

`apps/web/src/App.test.tsx` checks server-rendered placeholder text. There are no implemented application screens covered by that test. `docs/TECH_DEBT.md` explicitly records the web baseline as debt to grow with real screens:

| File                                | Lines | Functions | Branches | Statements |
| ----------------------------------- | ----: | --------: | -------: | ---------: |
| `apps/web/coverage-thresholds.json` |    23 |        98 |        0 |         18 |

These are minimum percentages, not evidence of broad behavior coverage. Add meaningful client tests alongside the first real screens, then raise thresholds using `scripts/coverage-ratchet.mjs`. The ratchet floors measured coverage minus two points and never lowers an existing threshold. Do not lower the function threshold to normalize the columns.

Server and shared also have package gates (`apps/server/coverage-thresholds.json`, `packages/shared/coverage-thresholds.json`); lower-than-perfect percentages alone are not a verified bug inventory. [Testing](how-to-contribute/testing.md) describes the actual offline, GPU and live boundaries.

## Paying debt without creating new debt

`techdebt.config.json` sets TODO/FIXME/HACK budgets to zero. Track a follow-up in an issue and `docs/TECH_DEBT.md` rather than dropping an unowned marker into source. When an exception is retired, remove its debt row and tighten the matching configuration in the same change.

Neither Knip configuration exceptions nor a dependency name establish unused or outdated production code. This page makes no package-age, unused-export, vulnerability or clone findings from an unrun scanner. Use the [tooling gates](how-to-contribute/tooling.md) to verify such a claim before opening a cleanup task.

## Key source files

| File                                | Purpose                                      |
| ----------------------------------- | -------------------------------------------- |
| `docs/TECH_DEBT.md`                 | Explicit debt register and retirement policy |
| `eslint.config.mjs`                 | Normal and legacy complexity ceilings        |
| `apps/web/coverage-thresholds.json` | Placeholder-era coverage baseline            |
| `apps/web/src/App.test.tsx`         | Actual current UI test scope                 |
| `scripts/coverage-ratchet.mjs`      | One-way threshold tightening                 |
| `techdebt.config.json`              | Zero marker budget                           |
