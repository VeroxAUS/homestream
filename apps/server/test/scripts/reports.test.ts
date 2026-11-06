import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from '../helpers.js';
import { runScript } from './repoHelpers.js';

const roots: string[] = [];
let dir: string;

beforeEach(() => {
  dir = makeTempDir('reports');
  roots.push(dir);
});
afterAll(() => {
  for (const root of roots) removeDir(root);
});

function writeReport(pkg: string, name: string, content: unknown): void {
  const folder = path.join(dir, 'reports', pkg);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, name), JSON.stringify(content));
}

function vitestJson(tests: Array<[string, number, string]>) {
  return {
    testResults: [
      {
        name: path.join(dir, 'apps', 'server', 'test', 'a.test.ts'),
        assertionResults: tests.map(([fullName, duration, status]) => ({ fullName, duration, status })),
      },
    ],
  };
}

describe('test-timing', () => {
  it('lists the 20 slowest passed or failed tests, slowest first, and writes test-timing.md', () => {
    const tests: Array<[string, number, string]> = Array.from({ length: 25 }, (_, i) => [
      `test ${i}`,
      i * 10,
      'passed',
    ]);
    tests.push(['skipped slow', 99_999, 'skipped']);
    writeReport('server', 'vitest.json', vitestJson(tests));
    const result = runScript(dir, 'test-timing.mjs');
    expect(result.status).toBe(0);
    const rows = result.stdout.split('\n').filter((line) => /^\| \d+ \|/.test(line));
    expect(rows).toHaveLength(20);
    expect(rows[0]).toContain('test 24');
    expect(result.stdout).not.toContain('skipped slow');
    expect(readFileSync(path.join(dir, 'reports', 'test-timing.md'), 'utf8')).toContain('# Slowest tests');
  });

  it('fails with a hint when there is no report', () => {
    const result = runScript(dir, 'test-timing.mjs');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pnpm test:report');
  });
});

describe('flaky-report', () => {
  it('lists tests that passed after a retry and exits 0', () => {
    writeReport('server', 'flaky.json', {
      flaky: [
        {
          name: 'suite > wobbles',
          file: path.join(dir, 'apps', 'server', 'test', 'a.test.ts'),
          retries: 1,
          durationMs: 12,
        },
      ],
    });
    const result = runScript(dir, 'flaky-report.mjs');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 flaky test(s)');
    expect(result.stdout).toContain('[server] suite > wobbles (1 retry)');
  });

  it('says so when nothing was flaky', () => {
    writeReport('shared', 'flaky.json', { flaky: [] });
    const result = runScript(dir, 'flaky-report.mjs');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No flaky tests');
  });
});
