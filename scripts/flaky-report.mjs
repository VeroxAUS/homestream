import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isMain } from './lib/util.mjs';

/** `reports/<package>/flaky.json` files written by scripts/vitest-flaky-reporter.mjs. */
export function findFlakyFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findFlakyFiles(full);
    return entry.name === 'flaky.json' ? [full] : [];
  });
}

export function main(argv, cwd = process.cwd()) {
  const reportsDir = path.join(cwd, argv[0] ?? 'reports');
  const files = findFlakyFiles(reportsDir).filter((file) => path.dirname(file) !== reportsDir);
  if (files.length === 0) {
    console.error(`[flaky-report] no flaky.json under ${reportsDir}. Run pnpm test:report first.`);
    return 1;
  }
  const flaky = files.flatMap((file) =>
    JSON.parse(readFileSync(file, 'utf8')).flaky.map((test) => ({
      ...test,
      package: path.basename(path.dirname(file)),
    })),
  );
  if (flaky.length === 0) {
    console.log('No flaky tests: every test passed on its first attempt.');
    return 0;
  }
  console.log(`${flaky.length} flaky test(s): failed at least once, then passed on a retry`);
  for (const test of flaky) {
    const file = path.relative(cwd, test.file).replaceAll('\\', '/');
    console.log(
      `  [${test.package}] ${test.name} (${test.retries} ${test.retries === 1 ? 'retry' : 'retries'}) ${file}`,
    );
  }
  console.log('Fix the test, or quarantine it as described in docs/runbooks/flaky-tests.md.');
  return 0;
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
