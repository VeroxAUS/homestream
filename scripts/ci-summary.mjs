import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isMain, repoRoot } from './lib/util.mjs';

/**
 * Markdown for the GitHub job summary: coverage per package against its thresholds, flaky tests and the slowest tests,
 * read from the files `pnpm test:coverage` and `node scripts/test-report.mjs --merge-only` leave behind.
 *   node scripts/ci-summary.mjs >> "$GITHUB_STEP_SUMMARY"
 */

const METRICS = ['lines', 'statements', 'functions', 'branches'];

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

/** Packages (`apps/*`, `packages/*`) that have a coverage summary, as `{name, totals, thresholds}`. */
export function readCoverage(root) {
  return ['apps', 'packages'].flatMap((group) => {
    const dir = path.join(root, group);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((name) => {
      const summary = readJson(path.join(dir, name, 'coverage', 'coverage-summary.json'));
      if (!summary) return [];
      const thresholds = readJson(path.join(dir, name, 'coverage-thresholds.json')) ?? {};
      const totals = Object.fromEntries(METRICS.map((metric) => [metric, summary.total[metric].pct]));
      return [{ name: `${group}/${name}`, totals, thresholds }];
    });
  });
}

export function coverageTable(entries) {
  if (entries.length === 0) return '_No coverage summaries found._\n';
  const cell = (entry, metric) => {
    const value = entry.totals[metric];
    const minimum = entry.thresholds[metric];
    return minimum === undefined ? `${value}%` : `${value}% (min ${minimum}%)`;
  };
  const rows = entries.map(
    (entry) => `| ${entry.name} | ${METRICS.map((metric) => cell(entry, metric)).join(' | ')} |`,
  );
  return ['| Package | Lines | Statements | Functions | Branches |', '|---|---|---|---|---|', ...rows, ''].join('\n');
}

export function flakySection(report) {
  const flaky = report?.flaky ?? [];
  if (flaky.length === 0) return 'No flaky tests: every test passed on its first attempt.\n';
  const rows = flaky.map((test) => `- ${test.name} (${test.retries} retr${test.retries === 1 ? 'y' : 'ies'})`);
  return [
    `${flaky.length} flaky test(s) passed only on a retry. See docs/runbooks/flaky-tests.md.`,
    '',
    ...rows,
    '',
  ].join('\n');
}

export function buildSummary(root) {
  const timing = path.join(root, 'reports', 'test-timing.md');
  return [
    '## Coverage',
    '',
    coverageTable(readCoverage(root)),
    '## Flaky tests',
    '',
    flakySection(readJson(path.join(root, 'reports', 'flaky.json'))),
    '## Slowest tests',
    '',
    existsSync(timing) ? readFileSync(timing, 'utf8').replace(/^# .*\n+/, '') : '_No timing report found._\n',
  ].join('\n');
}

if (isMain(import.meta.url)) process.stdout.write(buildSummary(repoRoot()));
