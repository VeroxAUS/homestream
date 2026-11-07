# Tech debt

How we track debt that is knowingly left in the code, and the list of debt that exists today.

## How entries are tracked

- A `TODO`, `FIXME` or `HACK` comment is a marker for debt. `pnpm techdebt` counts them per package and fails when a marker type goes over the budget in `techdebt.config.json`. The budget is the current count, so a new marker fails the check.
- To add a marker on purpose, resolve another one, or record the debt in the table below and agree a new budget in the same pull request. Never raise the budget silently.
- Debt that has no marker in the code (a lint exception, a threshold below the target, a skipped tier) is listed below with the file or setting that holds it.
- ESLint reports a comment that starts with `TODO`, `FIXME`, `HACK` or `XXX` as a warning (`no-warning-comments`), so markers also show up in the editor.
- Remove the row when the debt is paid, and lower the budget or exception it relied on.

## Current debt

### Complexity exceptions

`eslint.config.mjs` holds a per-file list of functions that are over the shared ceiling (`complexity` 20, `sonarjs/cognitive-complexity` 20, `max-depth` 4). Each entry is the measured value, so these files cannot get worse. Split the function and delete the entry.

| File                                           | Function           | Cyclomatic | Cognitive | Note                                               |
| ---------------------------------------------- | ------------------ | ---------- | --------- | -------------------------------------------------- |
| `apps/server/src/config.ts`                    | `loadConfig`       | 29         |           | One long list of env keys and their defaults       |
| `apps/server/src/health/checks/torbox.ts`      | `checkTorbox`      | 27         | 22        | Many TorBox account states                         |
| `apps/server/src/playback/diskCap.ts`          | `planDiskCap`      | 24         | 43        | Park and resume decisions for the transcode cap    |
| `apps/server/src/playback/probe.ts`            | `parseProbeOutput` | 31         | 22        | ffprobe JSON field handling                        |
| `apps/server/src/sourceproxy/serve.ts`         | `pumpRemote`       | 34         | 61        | Streaming hot path; refactor only with a benchmark |
| `apps/server/src/sourceproxy/sourceEntry.ts`   | one method         |            | 22        |                                                    |
| `apps/server/test/playback/subtitleSources.ts` | test helper        |            | 36        | Generates the subtitle test sources                |

### Line limits

ESLint fails a TypeScript or TSX file in `apps/*` and `packages/*` that has more than 400 lines (`max-lines`) or a function with more than 80 lines (`max-lines-per-function`). Blank lines and comments do not count. Test files (`test/`, `*.test.ts(x)`, `e2e/`) are exempt from the function limit only, because a `describe` block is one long function.

`code-limits.baseline.json` lists the files and functions that were over a limit when the rule was added. Each entry is the measured size (`lines`, `functionLines`) and becomes a per-file override in `eslint.config.mjs`. `scripts/code-limits.mjs` runs as part of `pnpm lint` (`lint:root`) and enforces the baseline:

- A ceiling must equal the measured size. Shrinking a file without lowering its ceiling fails, so the ceiling follows the file down. A file that is back within the limit must lose its entry.
- An entry may not be added or raised compared with the previous main commit (`git merge-base HEAD origin/main`, else `HEAD^`; no network). Split the file or function instead.
- Lower ceilings with `node scripts/code-limits.mjs --write`. It never raises one. `--init` regenerates the whole file and is only for the first baseline.

The playback manager was split into the modules under `apps/server/src/playback/` (`manager.ts` is the facade). The files left in the baseline are listed in `code-limits.baseline.json`; paying one off means deleting its entry.

### Coverage

Thresholds live in `<package>/coverage-thresholds.json` and are raised with `pnpm coverage:ratchet`. They never go down.

- `apps/web` has one placeholder test; its thresholds are the baseline and grow with the first real screens.

### Duplicate code

`.jscpd.json` fails above 0.5% duplicated lines. The tree has no clones today, and on about 14,000 lines a pasted 60-line block is under 1%, so a 5% gate would never trip. Tests, `dist` and `apps/tv` are not scanned.

### Test tiers

- The `gpu` tier needs NVENC and is never run in CI. It is skipped automatically when ffmpeg or an NVIDIA driver is missing.
- The `live` tier needs real TMDB and gateway keys and is skipped without them.

### Tooling

- `knip.jsonc` ignores `@homestream/shared` in `apps/web` until the first screen imports it, and the `scripts/**/*.d.mts` type files that TypeScript (not knip) resolves.
