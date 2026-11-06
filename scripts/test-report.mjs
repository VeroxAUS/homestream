import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, repoRoot } from './lib/util.mjs';
import { main as flakyReport } from './flaky-report.mjs';
import { main as testTiming } from './test-timing.mjs';

const PACKAGES = ['server', 'shared', 'web', 'desktop'];

const readIf = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

/** One JUnit file out of the per-package files: their `<testsuite>` elements under a single `<testsuites>`. */
export function mergeJunit(documents) {
  const suites = documents.flatMap((xml) => xml.match(/<testsuite\b[\s\S]*?<\/testsuite>/g) ?? []);
  return `<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites name="homestream">\n${suites.join('\n')}\n</testsuites>\n`;
}

export function mergeVitestJson(reports) {
  const sum = (key) => reports.reduce((total, report) => total + (report[key] ?? 0), 0);
  return {
    numTotalTests: sum('numTotalTests'),
    numPassedTests: sum('numPassedTests'),
    numFailedTests: sum('numFailedTests'),
    numPendingTests: sum('numPendingTests'),
    success: reports.every((report) => report.success),
    testResults: reports.flatMap((report) => report.testResults),
  };
}

function mergeReports(reportsDir) {
  const read = (name) => PACKAGES.map((pkg) => readIf(path.join(reportsDir, pkg, name))).filter(Boolean);
  writeFileSync(path.join(reportsDir, 'junit.xml'), mergeJunit(read('junit.xml')));
  writeFileSync(
    path.join(reportsDir, 'vitest.json'),
    `${JSON.stringify(mergeVitestJson(read('vitest.json').map((text) => JSON.parse(text))), null, 2)}\n`,
  );
  const flaky = read('flaky.json').flatMap((text) => JSON.parse(text).flaky);
  writeFileSync(path.join(reportsDir, 'flaky.json'), `${JSON.stringify({ flaky }, null, 2)}\n`);
}

/** Runs the CI-tier tests of every package in CI mode (retry 2, JUnit/JSON/flaky reporters), then prints the reports. */
export function main(root = repoRoot()) {
  const reportsDir = path.join(root, 'reports');
  rmSync(reportsDir, { recursive: true, force: true });
  mkdirSync(reportsDir, { recursive: true });

  const run = spawnSync('pnpm', ['-r', '--workspace-concurrency=1', 'run', 'test:ci'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, CI: 'true' },
  });
  mergeReports(reportsDir);
  testTiming([], root);
  flakyReport([], root);
  console.log(`Reports written to ${reportsDir}: junit.xml, vitest.json, flaky.json, test-timing.md`);
  return run.status ?? 1;
}

if (isMain(import.meta.url)) process.exit(main());
