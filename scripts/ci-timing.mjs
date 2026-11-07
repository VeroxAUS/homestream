import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  STICKY_MARKER,
  buildRecord,
  compareRecords,
  pickHistory,
  renderComparison,
  testsFromJunit,
  testsFromVitest,
} from './lib/ci-timing.mjs';
import { githubClient, redactValues, upsertMarkedComment } from './lib/github.mjs';
import { openMetrics, publishRecord, readRecords } from './lib/metrics-branch.mjs';
import { isMain } from './lib/util.mjs';

/**
 * Timing record and feedback for one `ci.yml` run (the "CI timing" job at the end of ci.yml runs it):
 * collects job and step durations from the GitHub API and per-test durations from the merged test reports, compares
 * them with the median of the last 10 successful main runs stored on the ci-metrics branch, writes the comparison to the
 * job summary, and then either commits the record to ci-metrics (push to main; nothing is written to main) or posts
 * and updates the one sticky comment of the pull request.
 *   node scripts/ci-timing.mjs --exclude-job "CI timing" [--reports reports] [--metrics-dir dir]
 */

const option = (argv, name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

export function readTests(reportsDir) {
  const json = path.join(reportsDir, 'vitest.json');
  if (existsSync(json)) return testsFromVitest(JSON.parse(readFileSync(json, 'utf8')));
  const xml = path.join(reportsDir, 'junit.xml');
  if (existsSync(xml)) return testsFromJunit(readFileSync(xml, 'utf8'));
  return null;
}

export function pullRequestOf(env) {
  if (!env.GITHUB_EVENT_PATH || !existsSync(env.GITHUB_EVENT_PATH)) return null;
  const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = payload.pull_request;
  if (!pr) return null;
  return { number: pr.number, fromFork: pr.head?.repo?.full_name !== env.GITHUB_REPOSITORY };
}

async function collect(github, env, { excludeJob, reportsDir }) {
  const runId = env.GITHUB_RUN_ID;
  const run = await github.request('GET', `{repo}/actions/runs/${runId}`);
  const { jobs } = await github.request('GET', `{repo}/actions/runs/${runId}/jobs?per_page=100&filter=latest`);
  const tests = readTests(reportsDir);
  if (tests === null)
    console.log(
      `::notice title=No test reports::No vitest.json or junit.xml under ${reportsDir}; test timings are left out.`,
    );
  return buildRecord({ run, jobs: jobs.filter((job) => job.name !== excludeJob), tests: tests ?? {} });
}

export async function main(argv, env = process.env, github = null) {
  const missing = ['GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID'].filter((name) => !env[name]);
  if (missing.length > 0) {
    console.error(`[ci-timing] missing environment: ${missing.join(', ')}`);
    return 1;
  }
  const client = github ?? githubClient({ token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY });
  const reportsDir = option(argv, '--reports', 'reports');
  const metricsDir = option(argv, '--metrics-dir', path.join(env.RUNNER_TEMP ?? '.', 'ci-metrics'));
  const record = await collect(client, env, { excludeJob: option(argv, '--exclude-job', ''), reportsDir });
  const remote = env.METRICS_REMOTE ?? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}.git`;

  const opened = openMetrics({ remote, dir: metricsDir, token: env.GITHUB_TOKEN });
  const history = pickHistory(readRecords(metricsDir), { excludeRunId: record.run.id });
  const markdown = renderComparison(compareRecords(record, history), { record });
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  console.log(markdown);

  const isMainPush = env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF_NAME === 'main';
  const pr = isMainPush ? null : pullRequestOf(env);
  if (isMainPush) {
    const result = await publishRecord({ dir: metricsDir, record, token: env.GITHUB_TOKEN });
    console.log(`${opened.created ? 'Created the ci-metrics branch. ' : ''}Committed ${result.file} to ci-metrics.`);
  } else if (pr?.fromFork) {
    console.log(
      '::notice title=No timing comment::Pull requests from forks get a read-only token, so the comment is left out. The comparison is in the job summary.',
    );
  } else if (pr) {
    await postStickyComment(client, pr.number, markdown);
  }
  return 0;
}

// Dependabot pull requests get a read-only token as well: the comparison then stays in the job summary.
async function postStickyComment(client, number, markdown) {
  try {
    await upsertMarkedComment(client, number, STICKY_MARKER, markdown);
    console.log(`Updated the timing comment on pull request #${number}.`);
  } catch (error) {
    if (error.status !== 403) throw error;
    console.log(
      '::notice title=No timing comment::The token may not write to this pull request. The comparison is in the job summary.',
    );
  }
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`[ci-timing] ${redactValues(error.message, [process.env.GITHUB_TOKEN])}`);
      process.exit(1);
    },
  );
}
