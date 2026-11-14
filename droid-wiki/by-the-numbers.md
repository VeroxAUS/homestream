# By the numbers

Data collected on **2026-11-14** (trusted system date), from committed tree **`3c31c453d49a737e9d51ba39c6bd41bfc4dbd092`**. Working-tree wiki edits are excluded. HomeStream has four workspaces and 38,504 physical source lines under the rules below; these are repository measurements, not individual productivity scores. See [architecture](overview/architecture.md) and [lore](lore.md).

The measured commit records **2026-11-15 06:21:10 +11:00** (**2026-11-14 19:21:10 UTC**). November 15 below is a commit-metadata bucket in UTC+11, not a later collection date or an independently verified wall-clock event.

## Measurement scope

Inventory reads `git ls-tree -rz <commit>` and UTF-8 blobs through `git cat-file --batch`, not the working tree. Exclude:

- `droid-wiki/`.
- Any path component named `node_modules`, `dist`, `coverage`, `reports`, `release`, `vendor`, or `.turbo`.
- Basenames `pnpm-lock.yaml`, `package-lock.json`, and `yarn.lock`.
- Generated exports `docs/openapi.json`, `docs/schema.sql`, and filenames containing `.generated.`. The implementation `apps/server/src/docs/generated.ts` remains included.
- NUL-containing or non-UTF-8 blobs from text totals.

There are **900 tracked paths**; exclusions leave **838 paths**, comprising **820 text files** and **18 binary assets** (17 desktop PNGs and one web font).

A **physical line** is one Python `str.splitlines()` element, including comments, blank lines, and an unterminated final line. **Nonblank lines** remove whitespace-only lines but retain comments. Neither measure is code-only LOC/SLOC; no code-only claim is made.

Assign each included text path to the first matching class:

1. **Test/support:** contains `/test/` or `/e2e/`, or matches `\.(test|spec)\.[cm]?[jt]sx?$`. Includes fixtures, helpers, smoke tests, and browser e2e support.
2. **Source:** remaining `/src/` files; `.mjs`, `.mts`, `.js`, or `.ts` files in any `scripts/` directory; `apps/web/index.html`; and `apps/desktop/assets/loading.html`. Includes styles, declarations, and the font license.
3. **Documentation:** remaining `.md` files and root `LICENSE`.
4. **Configuration/tool data:** everything else, including manifests, workflows, tooling data, and the proposal mockup `docs/ideas/settings-sidebar-mockup.html`. This classification does not imply that the mockup ships in the app.

## Size

| Class                          | Text files | Physical lines |
| ------------------------------ | ---------: | -------------: |
| Source                         |        429 |         38,504 |
| Test/support                   |        286 |         45,838 |
| Configuration/tool data        |         71 |          5,091 |
| Documentation and root license |         34 |          2,932 |
| **Total**                      |    **820** |     **92,365** |

Test/source ratios are **0.67:1 by files** and **1.19:1 by physical lines**. Helpers and fixtures count; these are not coverage or test-quality measurements.

Since the previous measured tree (`0b766e2f21a19468e04d0a9c7352c635a4357c87`), **six commits** comprise five bugfix commits and a wiki refresh. Outside the wiki, **36 files change, with 1,025 additions and 158 deletions**. Source gains **four files / 235 net physical lines**; test/support gains **three files / 613 net physical lines**; documentation gains **11 net lines**; configuration/tool data is unchanged. That is **859 net included text lines**, excluding generated exports. The fixes cover TorBox absence/metadata timers and unconfirmed starts, honest download labels, setup-wait cleanup, native toast actions, and subtitle extractor header/index reads. There is no new workspace or runtime subsystem. Fresh AST measurements find four more script nodes and ten more import edges; maximum chain lengths are unchanged. Workspace manifests and the dependency lockfile are unchanged.

### Lines by language

Extension-based totals cover the entire text inventory, including tests and configuration. TypeScript includes declarations. The horizontal chart shows programming/style/markup extensions; HTML includes the unshipped proposal mockup.

```mermaid
xychart-beta horizontal
    title "Committed physical lines, including comments and blanks"
    x-axis ["TypeScript", "TSX", "JavaScript", "CSS", "HTML"]
    y-axis "Physical lines" 0 --> 66000
    bar [65217, 9953, 5916, 3439, 944]
```

| Extension-based language                  |   Files | Physical lines | Nonblank lines |
| ----------------------------------------- | ------: | -------------: | -------------: |
| TypeScript (`.ts`, `.mts`, `.cts`)        |     549 |         65,217 |         58,970 |
| TSX                                       |      86 |          9,953 |          9,092 |
| JavaScript (`.js`, `.mjs`, `.cjs`)        |      44 |          5,916 |          5,428 |
| CSS                                       |      42 |          3,439 |          2,981 |
| Markdown                                  |      33 |          2,258 |          1,625 |
| JSON                                      |      30 |          1,914 |          1,914 |
| YAML                                      |      20 |          1,565 |          1,394 |
| Other text, including extensionless files |      11 |          1,035 |            841 |
| HTML                                      |       3 |            944 |            940 |
| Text (`.txt`)                             |       1 |             93 |             75 |
| JSONC                                     |       1 |             31 |             31 |
| **Total**                                 | **820** |     **92,365** |     **83,291** |

### Four workspace packages

`pnpm-workspace.yaml` lists **four packages**. Root tooling is not a fifth workspace; TV has no source workspace.

| Workspace         | Source files | Source lines | Test/support files | Test lines | Test/source files | Test/source lines |
| ----------------- | -----------: | -----------: | -----------------: | ---------: | ----------------: | ----------------: |
| `apps/server`     |          151 |       16,837 |                177 |     30,084 |              1.17 |              1.79 |
| `apps/web`        |          165 |       10,782 |                 74 |     11,118 |              0.45 |              1.03 |
| `apps/desktop`    |           38 |        3,662 |                 25 |      3,618 |              0.66 |              0.99 |
| `packages/shared` |           15 |        1,468 |                 10 |      1,018 |              0.67 |              0.69 |

The remaining **60 source files / 5,755 lines** belong to root `scripts/`. Workspace source includes authored HTML and desktop build/asset scripts; test counts include e2e and smoke support.

### Source organization

Counts are recursive, non-test source text files, not services or endpoint counts.

| Server directory            | Files | Server directory              | Files |
| --------------------------- | ----: | ----------------------------- | ----: |
| `apps/server/src/playback`  |    42 | `apps/server/src/routes`      |    14 |
| `apps/server/src/health`    |    11 | `apps/server/src/sourceproxy` |     9 |
| `apps/server/src/telemetry` |     9 | `apps/server/src/db`          |     7 |
| `apps/server/src/network`   |     7 | `apps/server/src/docs`        |     6 |
| `apps/server/src/gateway`   |     5 | `apps/server/src/downloads`   |     6 |
| `apps/server/src/events`    |     4 | `apps/server/src/progress`    |     4 |
| `apps/server/src/streams`   |     4 | `apps/server/src/tmdb`        |     3 |
| `apps/server/src/home`      |     2 | `apps/server/src/http`        |     2 |
| `apps/server/src/stats`     |     2 | `apps/server/src/metrics`     |     1 |
| `apps/server/src/prefetch`  |     1 | Directly in `apps/server/src` |    12 |

Server has **19 immediate source subdirectories**. Web has **11**: `apps/web/src/components` (47), `apps/web/src/player` (33), `apps/web/src/pages` (23), `apps/web/src/desktop` (20), `apps/web/src/lib` (15), `apps/web/src/telemetry` (9), `apps/web/src/notices` (4), `apps/web/src/events` (3), `apps/web/src/styles` (3), `apps/web/src/api` (2), and `apps/web/src/device` (1), plus four direct source files. Desktop has `apps/desktop/src/shell` (6), `apps/desktop/src/telemetry` (4), and 24 direct files. Shared has 15 direct source files.

## Activity

All **130 commits reachable from the measured commit** count, including the root and wiki automation. The checkout is not shallow. Available history runs from **2026-11-05 10:51:13 +11:00** (`c0781bd`) to **2026-11-15 06:21:10 +11:00** (`3c31c45`), about 235.5 hours.

Buckets use **committer timestamps normalized to UTC+11**, not author timestamps. ISO weeks start Monday. Latest buckets are partial through the measured commit, not an inferred collection time.

| Monthly bucket   | Commits | Weekly bucket     | Commits |
| ---------------- | ------: | ----------------- | ------: |
| 2026-08          |       0 | 2026-W43          |       0 |
| 2026-09          |       0 | 2026-W44          |       0 |
| 2026-10          |       0 | 2026-W45          |     113 |
| 2026-11, partial |     130 | 2026-W46, partial |      17 |

Daily totals are **12 on November 5**, **32 on November 6**, **48 on November 7**, **21 on November 8**, **1 on November 9**, **3 on November 10**, **3 on November 11**, **zero on November 12 and 13**, **8 on November 14**, and **2 on November 15**. Empty buckets mean no commits in the available history, not proof of no earlier private development. This short history cannot establish a steady development rate.

### Ninety-day churn

The window is **2026-08-17 06:21:10 through 2026-11-15 06:21:10 +11:00** (inclusive), ending at the measured commit's timestamp rather than the collection date. All 130 commits fall inside it.

For every commit, sum numeric additions and deletions from `git diff-tree --root --no-commit-id --numstat --no-renames -r <commit>`, applying the inventory path exclusions and omitting binary rows. Root additions, formatting, and moves count; moves are deletion plus addition. All recorded commits have zero or one parent, so no merge-parent policy is needed. Current-file rows require the path to remain in the measured text inventory.

| Current file                                            | Added | Deleted | Churn | Commits touching path |
| ------------------------------------------------------- | ----: | ------: | ----: | --------------------: |
| `apps/server/src/playback/manager.ts`                   | 1,994 |   1,673 | 3,667 |                    24 |
| `scripts/readiness-criteria.json`                       | 1,291 |       4 | 1,295 |                     2 |
| `apps/server/test/encode/tracks.test.ts`                |   684 |     304 |   988 |                     5 |
| `apps/server/test/encode/lifecycle.test.ts`             |   678 |     276 |   954 |                     7 |
| `apps/server/test/integration/progress-routes.test.ts`  |   893 |       1 |   894 |                     2 |
| `apps/server/test/integration/downloads.test.ts`        |   869 |      11 |   880 |                     4 |
| `apps/server/test/encode/progressive-subtitles.test.ts` |   582 |     190 |   772 |                     5 |
| `apps/server/src/downloads/service.ts`                  |   653 |     114 |   767 |                     6 |

Total included numeric churn is **116,903 added + deleted lines**. Directory totals also include historical paths that were deleted or moved:

| Directory, recursively | Added + deleted lines |
| ---------------------- | --------------------: |
| `apps/server/test`     |                44,568 |
| `apps/server/src`      |                23,077 |
| `apps/web/src`         |                21,374 |
| `scripts`              |                 7,474 |
| `apps/desktop/test`    |                 3,904 |
| `apps/desktop/src`     |                 3,374 |
| `apps/web/e2e`         |                 2,592 |
| `docs`                 |                 2,244 |
| `packages/shared/src`  |                 1,528 |
| `.github`              |                 1,548 |
| `packages/shared/test` |                 1,094 |

The manager's lead partly reflects its **November 7 decomposition** (`2d60a28`): **1,562 → 305 physical lines**, with **321 at the measured commit**. Historical churn does not mean the present file is monolithic or defective. See [playback](systems/playback/index.md) and [testing](how-to-contribute/testing.md).

## Bot and recorded AI attribution

Denominator: **all 130 reachable commits**. Inspect metadata internally without publishing identities or individual rankings. A bot author has the literal `[bot]` in author name or email, matched case-insensitively. A bot co-author has a line matching `^Co-authored-by:\s*(.*)$` case-insensitively whose value contains `[bot]`, also case-insensitively.

| Counted indicator                                           | Commits | Percentage |
| ----------------------------------------------------------- | ------: | ---------: |
| Bot co-author line                                          |     123 |     94.62% |
| Bot author                                                  |       7 |      5.38% |
| Either indicator, union without double-counting             |     130 |    100.00% |
| Co-author line specifically containing `factory-droid[bot]` |     123 |     94.62% |

**123/130 (94.62%) is a lower bound on explicitly recorded AI-assisted commits**, not AI-written lines or a fraction of engineering effort. Missing trailers can leave assistance unrecorded; a present trailer does not quantify its extent. The broader 100% bot-attribution union also includes automation authorship and is **not** a 100% AI-usage claim.

## Complexity proxies

These static measurements are not cyclomatic/cognitive complexity, runtime call depth, performance measurements, or maintainability scores.

### Average source-file size

All counts use the source text classification: **429 files / 38,504 physical lines**, averaging **89.8 lines/file** overall. Rows are recursive; drill-downs overlap parents.

| Directory                     | Files | Physical lines | Mean lines/file |
| ----------------------------- | ----: | -------------: | --------------: |
| `apps/server/src`             |   151 |         16,837 |           111.5 |
| `apps/web/src`                |   164 |         10,770 |            65.7 |
| `apps/desktop/src`            |    34 |          3,208 |            94.4 |
| `packages/shared/src`         |    15 |          1,468 |            97.9 |
| `scripts`                     |    60 |          5,755 |            95.9 |
| `apps/server/src/playback`    |    42 |          5,688 |           135.4 |
| `apps/server/src/sourceproxy` |     9 |          1,759 |           195.4 |
| `apps/server/src/downloads`   |     6 |          1,090 |           181.7 |
| `apps/web/src/player`         |    33 |          2,696 |            81.7 |
| `apps/web/src/desktop`        |    20 |          1,462 |            73.1 |
| `apps/desktop/src/shell`      |     6 |            901 |           150.2 |

### Deepest local import chains

This refresh **freshly parses committed blobs with the available TypeScript 6.0.3 parser**, using the previous measured tree's methodology. Nodes are classified source files ending `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, or `.cjs`. Visit AST import/export declarations with literal module specifiers, literal dynamic `import()` calls, and literal import-type nodes; include type-only edges and deduplicate each directed pair.

Resolve relative specifiers against the committed node set in this order: exact path; `.js` → `.ts`, `.js` → `.tsx`, `.cjs` → `.cts`, `.mjs` → `.mts`; appended `.ts`, `.tsx`, `.mts`, `.cts`, `.mjs`, `.js`; then `/index.ts`, `/index.tsx`, `/index.js`. Map bare `@homestream/shared` to `packages/shared/src/index.ts`; other external imports terminate the graph.

The graph has **384 nodes**, **1,058 distinct directed edges**, **zero parser diagnostics**, and **no cycles detected by depth-first traversal**. The **50 distinct unresolved local `(module, specifier)` pairs are CSS imports**, intentionally outside this script graph. Computed imports, CommonJS `require`, external dependency internals, and non-script assets are not modeled.

| Starting workspace | Longest chain, nodes | Edges | Start                          | Terminal                         |
| ------------------ | -------------------: | ----: | ------------------------------ | -------------------------------- |
| Server             |                   27 |    26 | `apps/server/src/docs/cli.ts`  | `packages/shared/src/catalog.ts` |
| Web                |                   14 |    13 | `apps/web/src/main.tsx`        | `packages/shared/src/catalog.ts` |
| Desktop            |                    9 |     8 | `apps/desktop/src/main.ts`     | `packages/shared/src/catalog.ts` |
| Shared             |                    4 |     3 | `packages/shared/src/index.ts` | `packages/shared/src/catalog.ts` |

One maximum chain, with every entry a repository-root path:

1. `apps/server/src/docs/cli.ts`
2. `apps/server/src/docs/generated.ts`
3. `apps/server/src/docs/export.ts`
4. `apps/server/src/app.ts`
5. `apps/server/src/http/observability.ts`
6. `apps/server/src/context.ts`
7. `apps/server/src/health/service.ts`
8. `apps/server/src/network/snapshot.ts`
9. `apps/server/src/playback/manager.ts`
10. `apps/server/src/playback/hlsServing.ts`
11. `apps/server/src/playback/recovery.ts`
12. `apps/server/src/playback/encoderLifecycle.ts`
13. `apps/server/src/playback/readAheadPacing.ts`
14. `apps/server/src/playback/context.ts`
15. `apps/server/src/playback/sessionSlots.ts`
16. `apps/server/src/playback/support.ts`
17. `apps/server/src/playback/session.ts`
18. `apps/server/src/playback/subtitleExtractor.ts`
19. `apps/server/src/playback/extractorSchedule.ts`
20. `apps/server/src/playback/playlist.ts`
21. `apps/server/src/playback/decision.ts`
22. `apps/server/src/playback/probe.ts`
23. `apps/server/src/errors.ts`
24. `packages/shared/src/index.ts`
25. `packages/shared/src/desktop.ts`
26. `packages/shared/src/playback.ts`
27. `packages/shared/src/catalog.ts`

Type-only imports and the shared barrel contribute to depth. This is **not** a 27-step runtime playback startup. The web maximum includes `apps/web/src/components/NavSearch.tsx` and `apps/web/src/pages/searchRoute.ts`.

### Exported symbols per workspace

Freshly create an in-memory TypeScript program over those committed script nodes, with `target: Latest`, `module: ESNext`, `moduleResolution: Bundler`, `allowJs: true`, `noLib: true`, and the same local resolver. No standard library or external dependency source is loaded. For each workspace's non-test `src/` module, call `checker.getSymbolAtLocation(sourceFile)`, then `checker.getExportsOfModule(symbol)`.

Count each exported **`(module path, export name)` slot** once. Type/value merges and overloads therefore count once within a module; default counts as `default`; local star re-exports are expanded. Distinct spellings are the union of those names within a workspace, not globally unique semantic identities.

| Workspace         | Scanned script modules | Exported module/name slots | Distinct name spellings |
| ----------------- | ---------------------: | -------------------------: | ----------------------: |
| `apps/server`     |                    151 |                        578 |                     567 |
| `apps/web`        |                    121 |                        288 |                     278 |
| `apps/desktop`    |                     34 |                        145 |                     145 |
| `packages/shared` |                     15 |                        508 |                     254 |

`packages/shared/src/index.ts` exposes **254 exported names**; the 508 slots include those names both in defining modules and the barrel. App totals describe internal module exports, not supported package APIs. This is a static exported-name inventory, not a full typecheck or dead-export audit; unresolved external modules are outside its scope. The method matches the previous measured tree, not older lexical export-occurrence approximations.

## Reproduction

Run from the repository root, substituting the fixed hash rather than a moving HEAD:

```sh
git ls-tree -rz 3c31c453d49a737e9d51ba39c6bd41bfc4dbd092
git rev-parse --is-shallow-repository
git log 3c31c453d49a737e9d51ba39c6bd41bfc4dbd092 --reverse --format='%h|%cI|%s'
git rev-list 3c31c453d49a737e9d51ba39c6bd41bfc4dbd092
git diff --numstat 0b766e2f21a19468e04d0a9c7352c635a4357c87 3c31c453d49a737e9d51ba39c6bd41bfc4dbd092 -- . ':!droid-wiki'
git diff-tree --root --no-commit-id --numstat --no-renames -r 2d60a28
```

Read committed blobs with `git cat-file --batch`; apply the exact exclusions and ordered classification; count Python `splitlines()` and nonblank lines. Bucket every reachable commit's committer timestamp in UTC+11. For churn, apply the stated 90-day window to numeric diff rows; require current inventory membership only for the file table. Apply the explicit AST/resolution rules above, detect cycles, then memoize longest directed paths; sort paths and outgoing edges for deterministic ties. Export counts use the stated TypeScript checker API.

Python 3 and Node 24.22.2 measurement programs ran from shell heredocs, keeping blob data and ASTs in memory; no temporary helper files were created. The required TypeScript 6.0.3 dependency was available when parsing, so no baseline counts were carried forward without a fresh parse. This statistics refresh installed no dependencies, ran no application tests, and started no server, encoder, GPU task, or upstream service.
