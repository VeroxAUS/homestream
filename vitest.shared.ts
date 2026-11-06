import { fileURLToPath } from 'node:url';

export const sharedSrcAlias = {
  '@homestream/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
};

export const baseTestConfig = {
  maxWorkers: 8,
  testTimeout: 20_000,
  hookTimeout: 20_000,
};

const reportsRoot = fileURLToPath(new URL('./reports/', import.meta.url));
const flakyReporter = fileURLToPath(new URL('./scripts/vitest-flaky-reporter.mjs', import.meta.url));

/**
 * CI mode (`CI=true`): retry flaky tests twice and write JUnit, JSON and flaky-test reports to `reports/<package>/`.
 * Locally nothing is retried so a flaky test is noticed instead of hidden.
 */
export function ciTestConfig(packageName: string) {
  if (!process.env.CI) return {};
  const dir = `${reportsRoot}${packageName}/`;
  return {
    retry: 2,
    reporters: [
      'default',
      ['junit', { outputFile: `${dir}junit.xml` }],
      ['json', { outputFile: `${dir}vitest.json` }],
      [flakyReporter, { outputFile: `${dir}flaky.json` }],
    ] as Array<string | [string, { outputFile: string }]>,
  };
}

export const coverageReporters = ['text-summary', 'json-summary', 'lcov'];