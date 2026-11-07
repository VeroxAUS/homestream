import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Hard limits for TypeScript sources in apps/* and packages/* (docs/TECH_DEBT.md, "Line limits"). */
export const MAX_FILE_LINES = 400;
export const MAX_FUNCTION_LINES = 80;
export const COUNT_OPTIONS = { skipBlankLines: true, skipComments: true };
export const BASELINE_FILE = 'code-limits.baseline.json';

/** Sources the limits apply to. */
const LIMITED_GLOBS = ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'];
/**
 * Tests are exempt from the function limit: a `describe` callback is a function that holds every case of a suite, so
 * its length says nothing about how hard the test is to read. The file limit still applies to them.
 */
const TEST_GLOBS = ['**/test/**', '**/*.test.{ts,tsx}', '**/e2e/**'];

export function isTestFile(file) {
  return /(^|\/)(test|e2e)\//.test(file) || /\.test\.tsx?$/.test(file);
}

/** `{ files: { '<path>': { lines?: number, functionLines?: number } } }`; empty when the file is missing. */
export function readBaseline(root) {
  const file = path.join(root, BASELINE_FILE);
  if (!existsSync(file)) return { files: {} };
  return JSON.parse(readFileSync(file, 'utf8'));
}

function fileLimitRule(max) {
  return ['error', { max, ...COUNT_OPTIONS }];
}

/** Flat-config blocks: the shared limits, the test exemption and one override per baselined file. */
export function limitConfigBlocks(baseline) {
  return [
    {
      files: LIMITED_GLOBS,
      rules: {
        'max-lines': fileLimitRule(MAX_FILE_LINES),
        'max-lines-per-function': fileLimitRule(MAX_FUNCTION_LINES),
      },
    },
    { files: TEST_GLOBS.map((glob) => `{apps,packages}/${glob}`), rules: { 'max-lines-per-function': 'off' } },
    ...Object.entries(baseline.files).map(([file, ceiling]) => ({
      files: [file],
      rules: {
        ...(ceiling.lines && { 'max-lines': fileLimitRule(ceiling.lines) }),
        ...(ceiling.functionLines && { 'max-lines-per-function': fileLimitRule(ceiling.functionLines) }),
      },
    })),
  ];
}
