import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildSummary, coverageTable, flakySection } from '../../../../scripts/ci-summary.mjs';
import { makeTempDir, removeDir } from '../helpers.js';

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) removeDir(dir);
});

const total = (pct: number) => ({ total: 10, covered: 9, skipped: 0, pct });

describe('ci-summary', () => {
  it('renders coverage next to the thresholds of each package', () => {
    const table = coverageTable([
      {
        name: 'apps/server',
        totals: { lines: 90, statements: 88, functions: 89, branches: 81 },
        thresholds: { lines: 87, branches: 79 },
      },
    ]);
    expect(table).toContain('| apps/server | 90% (min 87%) | 88% | 89% | 81% (min 79%) |');
    expect(coverageTable([])).toContain('No coverage summaries');
  });

  it('lists flaky tests or says there are none', () => {
    expect(flakySection({ flaky: [] })).toContain('No flaky tests');
    expect(flakySection({ flaky: [{ name: 'a > b', retries: 1 }] })).toContain('- a > b (1 retry)');
    expect(flakySection(null)).toContain('No flaky tests');
  });

  it('builds the whole summary from the files in a checkout', () => {
    const root = makeTempDir('ci-summary');
    roots.push(root);
    mkdirSync(path.join(root, 'apps', 'server', 'coverage'), { recursive: true });
    mkdirSync(path.join(root, 'reports'), { recursive: true });
    const summary = { total: { lines: total(91.5), statements: total(90), functions: total(80), branches: total(70) } };
    writeFileSync(path.join(root, 'apps', 'server', 'coverage', 'coverage-summary.json'), JSON.stringify(summary));
    writeFileSync(path.join(root, 'apps', 'server', 'coverage-thresholds.json'), JSON.stringify({ lines: 87 }));
    writeFileSync(path.join(root, 'reports', 'test-timing.md'), '# Slowest tests\n\n| # | ms |\n');
    const markdown = buildSummary(root);
    expect(markdown).toContain('| apps/server | 91.5% (min 87%) | 90% | 80% | 70% |');
    expect(markdown).toContain('## Flaky tests');
    expect(markdown).toContain('| # | ms |');
  });
});
