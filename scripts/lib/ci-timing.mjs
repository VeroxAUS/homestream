import path from 'node:path';

/**
 * Timing records of CI runs and their comparison. A record is one JSON file per `ci.yml` run on main (kept on the
 * `ci-metrics` branch); the same comparison is shown in the job summary and in the sticky pull request comment.
 */

const SCHEMA_VERSION = 1;
const HISTORY_RUNS = 10;
const SLOWER_RATIO = 1.2;
// A step that went from 1 s to 2 s is not a regression worth a line in the report.
const MIN_SLOWER_SECONDS = 2;
const MIN_SLOWER_TEST_MS = 20;
// Tests below this are not stored: they are noise in the comparison and would bloat a file kept forever.
const MIN_TEST_MS = 5;
const TOP_TESTS = 10;
const TOP_STEPS = 15;
const MAX_NAME = 100;

export const STICKY_MARKER = '<!-- homestream-ci-timing -->';

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const seconds = (from, to) => {
  const start = Date.parse(from ?? '');
  const end = Date.parse(to ?? '');
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round(((end - start) / 1000) * 10) / 10) : 0;
};

/** Step names repeat inside a job (post-run steps); the second one gets `#2` so every key is unique. */
function stepKeys(steps) {
  const seen = new Map();
  return steps.map((step) => {
    const count = (seen.get(step.name) ?? 0) + 1;
    seen.set(step.name, count);
    return count === 1 ? step.name : `${step.name} #${count}`;
  });
}

/**
 * The record of a run from the GitHub API objects of the run and its jobs. Jobs that have not completed (the timing job
 * itself) or were skipped are left out; the run counts as a success when every remaining job succeeded.
 */
export function buildRecord({ run, jobs, tests = {} }) {
  const finished = jobs.filter((job) => job.status === 'completed' && job.conclusion !== 'skipped' && job.started_at);
  const recorded = finished.map((job) => {
    const steps = (job.steps ?? []).filter((step) => step.conclusion !== 'skipped' && step.started_at);
    const keys = stepKeys(steps);
    return {
      name: job.name,
      conclusion: job.conclusion,
      seconds: seconds(job.started_at, job.completed_at),
      steps: steps.map((step, index) => ({
        name: keys[index],
        conclusion: step.conclusion,
        seconds: seconds(step.started_at, step.completed_at),
      })),
    };
  });
  const completedAt =
    finished
      .map((job) => job.completed_at)
      .sort()
      .at(-1) ?? run.updated_at;
  return {
    schema: SCHEMA_VERSION,
    run: {
      id: run.id,
      attempt: run.run_attempt ?? 1,
      url: run.html_url,
      sha: run.head_sha,
      branch: run.head_branch,
      event: run.event,
      startedAt: run.run_started_at ?? run.created_at,
      completedAt,
      conclusion: recorded.every((job) => job.conclusion === 'success') ? 'success' : 'failure',
    },
    totalSeconds: seconds(run.run_started_at ?? run.created_at, completedAt),
    jobs: recorded,
    tests,
  };
}

/** `{"apps/server/test/a.test.ts :: suite name": ms}` of the tests that took at least MIN_TEST_MS, from a vitest JSON report. */
export function testsFromVitest(report) {
  const out = {};
  for (const file of report?.testResults ?? []) {
    const match = /(?:^|[\\/])((?:apps|packages)[\\/].+)$/.exec(file.name ?? '');
    const relative = (match ? match[1] : path.basename(file.name ?? 'unknown')).replaceAll('\\', '/');
    for (const test of file.assertionResults ?? []) {
      if (test.status !== 'passed' && test.status !== 'failed') continue;
      const ms = Math.round(test.duration ?? 0);
      if (ms >= MIN_TEST_MS) out[`${relative} :: ${test.fullName}`] = ms;
    }
  }
  return out;
}

const decodeXml = (text) =>
  text.replace(/&(lt|gt|quot|apos|amp);/g, (_, name) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[name]);

/** The same map from the merged JUnit XML, for runs whose JSON report is missing. */
export function testsFromJunit(xml) {
  const out = {};
  for (const match of String(xml ?? '').matchAll(/<testcase\b([^>]*?)\/?>/g)) {
    const attribute = (name) => new RegExp(`\\b${name}="([^"]*)"`).exec(match[1])?.[1];
    const file = decodeXml(attribute('classname') ?? 'unknown');
    const name = decodeXml(attribute('name') ?? '').replaceAll(' > ', ' ');
    const ms = Math.round(Number(attribute('time') ?? 0) * 1000);
    if (ms >= MIN_TEST_MS) out[`${file} :: ${name}`] = ms;
  }
  return out;
}

/** File name of a record: sortable by completion time, unique per run and attempt. */
export function recordFileName(record) {
  const stamp = String(record.run.completedAt).replace(/[-:]/g, '').replace(/\.\d+/, '');
  return `runs/${stamp}-${record.run.id}-${record.run.attempt}.json`;
}

/** The newest `limit` successful records other than the run itself, newest first. */
export function pickHistory(records, { excludeRunId, limit = HISTORY_RUNS } = {}) {
  return records
    .filter((record) => record.run.conclusion === 'success' && record.run.id !== excludeRunId)
    .sort((a, b) => String(b.run.completedAt).localeCompare(String(a.run.completedAt)))
    .slice(0, limit);
}

function slower(current, baseline, minDelta) {
  return baseline > 0 && current > baseline * SLOWER_RATIO && current - baseline >= minDelta;
}

const change = (current, baseline) => (baseline > 0 ? Math.round(((current - baseline) / baseline) * 100) : 0);

/** The comparison of one record against the medians of the history. */
export function compareRecords(current, history) {
  const total = median(history.map((record) => record.totalSeconds));
  const comparison = {
    runs: history.length,
    runIds: history.map((record) => record.run.id),
    total:
      total === null
        ? null
        : { current: current.totalSeconds, median: total, percent: change(current.totalSeconds, total) },
    jobs: [],
    steps: [],
    tests: [],
  };
  if (history.length === 0) return comparison;

  for (const job of current.jobs) {
    const pastJobs = history.flatMap((record) => record.jobs.filter((past) => past.name === job.name));
    const jobMedian = median(pastJobs.map((past) => past.seconds));
    if (jobMedian !== null && slower(job.seconds, jobMedian, MIN_SLOWER_SECONDS)) {
      comparison.jobs.push({
        name: job.name,
        current: job.seconds,
        median: jobMedian,
        percent: change(job.seconds, jobMedian),
      });
    }
    for (const step of job.steps) {
      const pastSteps = pastJobs.flatMap((past) => past.steps.filter((s) => s.name === step.name));
      const stepMedian = median(pastSteps.map((s) => s.seconds));
      if (stepMedian !== null && slower(step.seconds, stepMedian, MIN_SLOWER_SECONDS)) {
        comparison.steps.push({
          name: `${job.name} / ${step.name}`,
          current: step.seconds,
          median: stepMedian,
          percent: change(step.seconds, stepMedian),
        });
      }
    }
  }

  for (const [name, ms] of Object.entries(current.tests ?? {})) {
    const past = history.flatMap((record) => (name in (record.tests ?? {}) ? [record.tests[name]] : []));
    const testMedian = median(past);
    if (testMedian !== null && slower(ms, testMedian, MIN_SLOWER_TEST_MS)) {
      comparison.tests.push({ name, current: ms, median: testMedian, percent: change(ms, testMedian) });
    }
  }
  const byLoss = (a, b) => b.current - b.median - (a.current - a.median);
  comparison.tests = comparison.tests.sort(byLoss).slice(0, TOP_TESTS);
  comparison.jobs.sort(byLoss);
  comparison.steps = comparison.steps.sort(byLoss).slice(0, TOP_STEPS);
  return comparison;
}

export function formatSeconds(value) {
  const total = Math.round(value);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

const formatMs = (value) => (value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`);
const signed = (percent) => `${percent >= 0 ? '+' : ''}${percent}%`;

/** Names come from workflow files and test titles, and a pull request controls them: keep letters, digits and a few signs. */
export function safeName(name) {
  return String(name ?? '')
    .replace(/[^\p{L}\p{N} _.,:/()#+=-]/gu, '?')
    .replaceAll('://', ':/ /')
    .slice(0, MAX_NAME);
}

const table = (head, rows) => [
  `| ${head.join(' | ')} |`,
  `|${head.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.join(' | ')} |`),
];

/** Markdown of a comparison; `against` says what the medians are of ("the last 10 main runs"). */
export function renderComparison(comparison, { record, against = 'main' }) {
  const lines = [STICKY_MARKER, '## CI timing', ''];
  const run = record.run;
  lines.push(
    `Run [${run.id}](${run.url}) on \`${String(run.sha).slice(0, 7)}\`, wall time ${formatSeconds(record.totalSeconds)}.`,
    '',
  );
  if (comparison.runs === 0) {
    lines.push(
      `No baseline yet: there are no earlier successful ${against} runs recorded on the ci-metrics branch.`,
      '',
    );
    return lines.join('\n');
  }
  lines.push(
    `Compared with the median of the last ${comparison.runs} successful ${against} run(s) (more than ${Math.round((SLOWER_RATIO - 1) * 100)}% slower is flagged).`,
    '',
  );
  if (comparison.total) {
    lines.push(
      '### Total',
      '',
      ...table(
        ['', 'This run', 'Median', 'Change'],
        [
          [
            'Wall time',
            formatSeconds(comparison.total.current),
            formatSeconds(comparison.total.median),
            signed(comparison.total.percent),
          ],
        ],
      ),
      '',
    );
  }
  const secondsRows = (items) =>
    items.map((i) => [safeName(i.name), formatSeconds(i.current), formatSeconds(i.median), signed(i.percent)]);
  lines.push('### Jobs and steps more than 20% slower', '');
  if (comparison.jobs.length + comparison.steps.length === 0) lines.push('None.', '');
  else {
    lines.push(
      ...table(
        ['Job or step', 'This run', 'Median', 'Change'],
        [...secondsRows(comparison.jobs), ...secondsRows(comparison.steps)],
      ),
      '',
    );
  }
  lines.push('### Top regressed tests', '');
  if (comparison.tests.length === 0) lines.push('None.', '');
  else {
    lines.push(
      ...table(
        ['Test', 'This run', 'Median', 'Change'],
        comparison.tests.map((t) => [safeName(t.name), formatMs(t.current), formatMs(t.median), signed(t.percent)]),
      ),
      '',
    );
  }
  return lines.join('\n');
}
