# CI: Droid review, timing history and code health

Three advisory automations sit next to the required checks. None of them is a required check, none writes to `main`, and a failure in any of them never turns the `Linux` or `Windows` job red. Branch protection is unchanged: the required checks are `Linux` and `Windows`, there is no approval rule, and the owner may push directly (see [AGENTS.md](../AGENTS.md#ci-checks)).

| Automation                     | Workflow                                                    | Runs on                                        | Secret            |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------------- | ----------------- |
| Droid review                   | [`droid-review.yml`](../.github/workflows/droid-review.yml) | every pull request to main, every push to main | `FACTORY_API_KEY` |
| CI timing history and feedback | job `CI timing` in [`ci.yml`](../.github/workflows/ci.yml)  | every CI run                                   | none              |
| Daily code-health review       | [`code-health.yml`](../.github/workflows/code-health.yml)   | once a day, manual dispatch                    | `FACTORY_API_KEY` |

## Droid review

- **Pull requests to main** (same repository, not a draft): the job `Droid PR review` runs Factory's official [`Factory-AI/droid-action`](https://github.com/Factory-AI/droid-action) (pinned by commit SHA, release v13) with `automatic_review`. It posts inline review comments and one summary comment on the pull request (`use_sticky_comment` is on). The action still adds a "Droid finished" comment per push, so the job `Droid comment cleanup` runs `scripts/droid-pr-cleanup.mjs` afterwards and deletes the earlier ones; the pull request keeps only the newest. It authenticates with `FACTORY_API_KEY` and posts with the workflow token (`github_token`), so the Factory Droid GitHub App does not need to be installed.
- **Pushes to main**: the job `Droid push review` runs `droid exec` through `scripts/droid-push-review.mjs`. It reviews the commits of the push (`github.event.before` to the new tip, wiki and lockfile changes left out), then posts the findings as commit comments on the pushed commit: inline comments on lines the push changed, plus exactly one summary comment. When nothing reviewable is left (only the wiki or the lockfile changed), the script posts the short summary "Droid review: no reviewable changes (only generated files)" and does not call Droid, not even without `FACTORY_API_KEY`. A re-run for the same commit deletes the earlier comments of the script first, so a commit never collects duplicates. Findings on lines the push did not change go into the summary. The action itself only supports pull requests, which is why pushes use `droid exec`.
- **Forks and Dependabot**: those runs get no secrets. The job `Droid review skipped` prints a `::notice` annotation and finishes green; the review job does not start.
- **Failure handling**: both review jobs use `continue-on-error`. A missing key, an exhausted quota or a Factory outage ends in a notice or a short failure summary comment, never in a red required check. The workflow has no `paths-ignore`: a push that only merges the generated wiki gets the short summary, so every push to main has a summary comment (`ci.yml` itself still skips wiki-only pushes).
- **What reaches Factory**: the diff and the repository checkout of the run. The key is passed through the environment only and is removed from any error text before it is logged or commented.

## CI timing history

The job `CI timing` in `ci.yml` waits for `Linux`, `Web e2e` and `Windows` (`if: !cancelled()`, `continue-on-error: true`) and runs `node scripts/ci-timing.mjs`:

1. It reads the run, its jobs and their steps from the GitHub API (durations come from `started_at` and `completed_at`) and the per-test durations from the `test-reports` artifact of the Linux job (`reports/vitest.json`, falling back to `reports/junit.xml`). Tests under 5 ms are left out.
2. It builds one record (schema version 1) and compares it with the median of the last 10 successful runs on `main`.
3. It writes the comparison to the job summary: total wall time, jobs and steps more than 20% slower than the median (and at least 2 seconds slower), and the top regressed tests (more than 20% and at least 20 ms).
4. On a run on main (a push or a manual dispatch) it commits the record to the branch `ci-metrics`. On a pull request it creates or updates the one sticky comment.

Runs on main are never cancelled by a newer push: `ci.yml` cancels superseded runs only for other refs, and each main run has its own concurrency group (a pending run in a shared group would be replaced by the next one). So every `ci.yml` run on main leaves exactly one record.

### The `ci-metrics` branch

`ci-metrics` is an orphan branch with no relation to `main`. The job creates it on the first run and only ever adds files: `runs/<completion time>-<run id>-<attempt>.json`, plus a `README.md`. Nothing is rewritten or pruned, so the history is kept indefinitely. The job never pushes to `main`; it pushes `HEAD:refs/heads/ci-metrics` as `github-actions[bot]` and retries with a rebase when two runs finish at the same time.

A record:

```json
{
  "schema": 1,
  "run": {
    "id": 1,
    "attempt": 1,
    "url": "...",
    "sha": "...",
    "branch": "main",
    "event": "push",
    "startedAt": "...",
    "completedAt": "...",
    "conclusion": "success"
  },
  "totalSeconds": 540,
  "jobs": [
    {
      "name": "Linux",
      "conclusion": "success",
      "seconds": 420,
      "steps": [{ "name": "Unit tests", "conclusion": "success", "seconds": 130 }]
    }
  ],
  "tests": { "apps/server/test/net.test.ts :: parses a range": 12 }
}
```

`tests` maps `<file> :: <full test name>` to milliseconds. Read the history with `git clone --branch ci-metrics --single-branch <repo-url>`.

### The sticky pull request comment

The comment starts with the hidden marker `<!-- homestream-ci-timing -->`. The job looks for that marker, edits the comment in place on every new push and removes any duplicate, so a pull request has at most one. It compares the pull request run with the same median of recent `main` runs. Pull requests from forks get no write token: the comparison stays in the job summary and a notice explains why. Pull request runs never write to `ci-metrics`.

## Daily code-health review

`code-health.yml` runs once a day (18:30 UTC) and on `workflow_dispatch` (`gh workflow run code-health.yml`).

1. `node scripts/code-health.mjs plan` finds the one open issue titled `Code health` and reads the last reviewed SHA from the hidden marker `<!-- code-health:last-reviewed-sha=<sha> -->` in its body. When `main` has no new commit since that SHA (or only generated wiki commits), it sets `should_run=false` and the rest of the job is skipped. That is a clean, green skip.
2. Otherwise `node scripts/code-health.mjs review` runs `droid exec` read-only over the changes since that SHA. The prompt holds the code-health rules: the 400-line file and 80-line function limits with the baseline in `code-limits.baseline.json`, complexity, duplication, dead code and test gaps, plus the output of `scripts/code-limits.mjs`.
3. It rewrites the body of the issue in place (new findings, new marker). If the issue is missing it creates it. There is never a second one. If Droid fails, the issue is left untouched, so the next run reviews the same range again.

The workflow has `contents: read` and `issues: write` only. It pushes no code, opens no pull request and nothing else depends on it.

## Setup and switching things off

- `FACTORY_API_KEY` is a repository secret (also used by the [wiki refresh](wiki.md)). Without it the push review and the code-health review print a notice and succeed, and the pull request review ends as a tolerated failure (`continue-on-error`).
- Disable the Droid review or the code-health run with `gh workflow disable droid-review.yml` or `gh workflow disable code-health.yml`. The timing job has no switch; remove the job from `ci.yml`.
- The scripts are plain Node (`scripts/ci-timing.mjs`, `scripts/droid-push-review.mjs`, `scripts/code-health.mjs`, helpers in `scripts/lib/`) with unit tests in `apps/server/test/scripts/`. They need only `GITHUB_TOKEN` (and `FACTORY_API_KEY` for the Droid scripts) and the `droid` CLI on the path.
