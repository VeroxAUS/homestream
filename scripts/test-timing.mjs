import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMain } from './lib/util.mjs';

const TOP = 20;

/** Vitest JSON reports (`reports/<package>/vitest.json`, or the merged `reports/vitest.json`) below a directory. */
export function findJsonReports(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findJsonReports(full);
    return entry.name === 'vitest.json' ? [full] : [];
  });
}

/** The slowest tests across the given reports. Only per-package reports are read when they exist, so tests are not counted twice. */
export function slowestTests(reports, top = TOP) {
  const tests = reports.flatMap((report) =>
    report.json.testResults.flatMap((file) =>
      file.assertionResults
        .filter((test) => test.status === 'passed' || test.status === 'failed')
        .map((test) => ({
          name: test.fullName,
          file: path.relative(process.cwd(), file.name).replaceAll('\\', '/'),
          durationMs: Math.round(test.duration ?? 0),
        })),
    ),
  );
  return tests.sort((a, b) => b.durationMs - a.durationMs).slice(0, top);
}

export function toMarkdown(tests) {
  const rows = tests.map((t, i) => `| ${i + 1} | ${t.durationMs} | ${t.name.replaceAll('|', '\\|')} | ${t.file} |`);
  return ['# Slowest tests', '', '| # | ms | Test | File |', '|---|---:|---|---|', ...rows, ''].join('\n');
}

export function main(argv, cwd = process.cwd()) {
  const reportsDir = path.join(cwd, argv[0] ?? 'reports');
  const files = findJsonReports(reportsDir);
  const perPackage = files.filter((file) => path.dirname(file) !== reportsDir);
  const reports = (perPackage.length > 0 ? perPackage : files).map((file) => ({
    file,
    json: JSON.parse(readFileSync(file, 'utf8')),
  }));
  if (reports.length === 0) {
    console.error(`[test-timing] no vitest.json under ${reportsDir}. Run pnpm test:report first.`);
    return 1;
  }
  const tests = slowestTests(reports);
  const markdown = toMarkdown(tests);
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(path.join(reportsDir, 'test-timing.md'), markdown);
  console.log(markdown);
  return 0;
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
