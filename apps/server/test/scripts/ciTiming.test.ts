import { describe, expect, it } from 'vitest';
import {
  STICKY_MARKER,
  buildRecord,
  compareRecords,
  formatSeconds,
  median,
  pickHistory,
  recordFileName,
  renderComparison,
  safeName,
  testsFromJunit,
  testsFromVitest,
  type JobRecord,
  type TimingRecord,
} from '../../../../scripts/lib/ci-timing.mjs';

const at = (offsetSeconds: number) => new Date(Date.UTC(2026, 10, 7, 10, 0, 0) + offsetSeconds * 1000).toISOString();

describe('median', () => {
  it('handles odd, even and empty lists and ignores non-numbers', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([Number.NaN, 5])).toBe(5);
  });
});

describe('buildRecord', () => {
  const run = {
    id: 42,
    run_attempt: 1,
    html_url: 'https://github.test/run/42',
    head_sha: 'a'.repeat(40),
    head_branch: 'main',
    event: 'push',
    run_started_at: at(0),
    created_at: at(-5),
    updated_at: at(900),
  };
  const step = (name: string, start: number, end: number, conclusion = 'success') => ({
    name,
    conclusion,
    started_at: at(start),
    completed_at: at(end),
  });

  it('records completed jobs and their steps, leaves out skipped work and the running timing job', () => {
    const record = buildRecord({
      run,
      jobs: [
        {
          name: 'Linux',
          status: 'completed',
          conclusion: 'success',
          started_at: at(10),
          completed_at: at(310),
          steps: [
            step('Set up job', 10, 12),
            step('Post Run actions/checkout', 300, 301),
            step('Post Run actions/checkout', 301, 303),
            step('Skipped step', 0, 0, 'skipped'),
          ],
        },
        {
          name: 'Windows',
          status: 'completed',
          conclusion: 'success',
          started_at: at(10),
          completed_at: at(610),
          steps: [],
        },
        {
          name: 'Docs only',
          status: 'completed',
          conclusion: 'skipped',
          started_at: at(10),
          completed_at: at(10),
          steps: [],
        },
        {
          name: 'CI timing',
          status: 'in_progress',
          conclusion: null,
          started_at: at(620),
          completed_at: null,
          steps: [],
        },
      ],
      tests: { 'apps/a.test.ts :: x': 40 },
    });
    expect(record.jobs.map((job: JobRecord) => job.name)).toEqual(['Linux', 'Windows']);
    expect(record.jobs[0]?.steps.map((s) => s.name)).toEqual([
      'Set up job',
      'Post Run actions/checkout',
      'Post Run actions/checkout #2',
    ]);
    expect(record.jobs[0]?.seconds).toBe(300);
    expect(record.totalSeconds).toBe(610);
    expect(record.run).toMatchObject({
      id: 42,
      attempt: 1,
      conclusion: 'success',
      completedAt: at(610),
      branch: 'main',
    });
    expect(record.tests).toEqual({ 'apps/a.test.ts :: x': 40 });
  });

  it('marks a run with a failed job as a failure', () => {
    const record = buildRecord({
      run,
      jobs: [
        {
          name: 'Linux',
          status: 'completed',
          conclusion: 'failure',
          started_at: at(1),
          completed_at: at(9),
          steps: [],
        },
      ],
    });
    expect(record.run.conclusion).toBe('failure');
  });
});

describe('test timings from the reports', () => {
  it('keys vitest tests by repo-relative file and name and drops tests under the floor', () => {
    const report = {
      testResults: [
        {
          name: '/home/runner/work/homestream/homestream/apps/server/test/a.test.ts',
          assertionResults: [
            { fullName: 'suite slow', status: 'passed', duration: 120.4 },
            { fullName: 'suite fast', status: 'passed', duration: 0.5 },
            { fullName: 'suite skipped', status: 'pending', duration: 900 },
          ],
        },
        {
          name: 'C:\\w\\homestream\\packages\\shared\\test\\b.test.ts',
          assertionResults: [{ fullName: 'win', status: 'failed', duration: 30 }],
        },
      ],
    };
    expect(testsFromVitest(report)).toEqual({
      'apps/server/test/a.test.ts :: suite slow': 120,
      'packages/shared/test/b.test.ts :: win': 30,
    });
  });

  it('reads the JUnit XML when the JSON report is missing', () => {
    const xml = `<testsuites><testsuite name="x"><testcase classname="test/a.test.ts" name="suite &gt; case &amp; more" time="0.250"></testcase>
      <testcase classname="test/a.test.ts" name="quick" time="0.001"/></testsuite></testsuites>`;
    expect(testsFromJunit(xml)).toEqual({ 'test/a.test.ts :: suite case & more': 250 });
  });
});

function record(
  id: number,
  overrides: Partial<TimingRecord> & {
    total?: number;
    jobSeconds?: number;
    stepSeconds?: number;
    tests?: Record<string, number>;
  } = {},
): TimingRecord {
  return {
    schema: 1,
    run: {
      id,
      attempt: 1,
      url: `https://github.test/run/${id}`,
      sha: `${id}`.padStart(40, '0'),
      branch: 'main',
      event: 'push',
      startedAt: at(0),
      completedAt: at(id * 1000),
      conclusion: 'success',
      ...overrides.run,
    },
    totalSeconds: overrides.total ?? 600,
    jobs: [
      {
        name: 'Linux',
        conclusion: 'success',
        seconds: overrides.jobSeconds ?? 300,
        steps: [
          { name: 'Install dependencies', conclusion: 'success', seconds: overrides.stepSeconds ?? 20 },
          { name: 'Format check', conclusion: 'success', seconds: 1 },
        ],
      },
    ],
    tests: overrides.tests ?? { 'apps/a.test.ts :: stable': 100, 'apps/a.test.ts :: slowing': 100 },
  };
}

describe('history and file names', () => {
  it('names files by completion time, run id and attempt', () => {
    const name = recordFileName({ run: { completedAt: '2026-11-07T10:16:40.000Z', id: 7, attempt: 2 } });
    expect(name).toBe('runs/20261107T101640Z-7-2.json');
  });

  it('picks the newest ten successful records other than the run itself', () => {
    const records = Array.from({ length: 14 }, (_, i) => record(i + 1));
    records[13]!.run.conclusion = 'failure';
    const picked = pickHistory(records, { excludeRunId: 13 });
    expect(picked).toHaveLength(10);
    expect(picked.map((r) => r.run.id)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  });
});

describe('compareRecords', () => {
  const history = Array.from({ length: 5 }, (_, i) => record(i + 1));

  it('reports no regression for a run equal to the median', () => {
    const comparison = compareRecords(record(99), history);
    expect(comparison.runs).toBe(5);
    expect(comparison.total).toEqual({ current: 600, median: 600, percent: 0 });
    expect([comparison.jobs, comparison.steps, comparison.tests]).toEqual([[], [], []]);
  });

  it('flags jobs and steps more than 20% slower, not 20% or less and not tiny steps', () => {
    const slow = record(99, { total: 900, jobSeconds: 361, stepSeconds: 25 });
    const comparison = compareRecords(slow, history);
    expect(comparison.total?.percent).toBe(50);
    expect(comparison.jobs).toEqual([{ name: 'Linux', current: 361, median: 300, percent: 20 }]);
    expect(comparison.steps.map((s) => s.name)).toEqual(['Linux / Install dependencies']);
    const exactly = compareRecords(record(99, { jobSeconds: 360, stepSeconds: 24 }), history);
    expect(exactly.jobs).toEqual([]);
    expect(exactly.steps).toEqual([]);
    const tiny = record(99);
    tiny.jobs[0]!.steps[1]!.seconds = 2.9;
    expect(compareRecords(tiny, history).steps).toEqual([]);
  });

  it('ranks the most regressed tests first, caps the list at ten and ignores tests without a baseline', () => {
    const base: Record<string, number> = {};
    const now: Record<string, number> = { 'apps/new.test.ts :: brand new': 5000 };
    for (let i = 0; i < 12; i += 1) {
      base[`t${i}`] = 100;
      now[`t${i}`] = 100 + (i + 1) * 50;
    }
    const comparison = compareRecords(
      record(99, { tests: now }),
      [1, 2, 3].map((id) => record(id, { tests: base })),
    );
    expect(comparison.tests).toHaveLength(10);
    expect(comparison.tests[0]?.name).toBe('t11');
    expect(comparison.tests.some((t) => t.name.includes('brand new'))).toBe(false);
  });

  it('uses the median, so one slow outlier in the history does not move the baseline', () => {
    const outlier = [record(1), record(2), record(3, { total: 5000 }), record(4), record(5)];
    expect(compareRecords(record(99), outlier).total?.median).toBe(600);
  });

  it('has nothing to compare without history', () => {
    expect(compareRecords(record(1), [])).toMatchObject({ runs: 0, total: null, jobs: [], steps: [], tests: [] });
  });
});

describe('renderComparison', () => {
  const current = record(99, {
    total: 900,
    jobSeconds: 400,
    stepSeconds: 40,
    tests: { 'apps/a.test.ts :: slowing': 300 },
  });
  const history = [1, 2, 3].map((id) => record(id));

  it('has the marker, the total, the slower jobs and steps and the regressed tests', () => {
    const markdown = renderComparison(compareRecords(current, history), { record: current });
    expect(markdown.startsWith(STICKY_MARKER)).toBe(true);
    expect(markdown).toContain('median of the last 3 successful main run(s)');
    expect(markdown).toContain('| Wall time | 15m 00s | 10m 00s | +50% |');
    expect(markdown).toContain('### Jobs and steps more than 20% slower');
    expect(markdown).toContain('| Linux | 6m 40s | 5m 00s | +33% |');
    expect(markdown).toContain('| Linux / Install dependencies | 40s | 20s | +100% |');
    expect(markdown).toContain('### Top regressed tests');
    expect(markdown).toContain('| apps/a.test.ts :: slowing | 300ms | 100ms | +200% |');
  });

  it('says so when nothing regressed and when there is no baseline', () => {
    const same = record(99);
    const markdown = renderComparison(compareRecords(same, history), { record: same });
    expect(markdown.match(/None\./g)).toHaveLength(2);
    expect(renderComparison(compareRecords(same, []), { record: same })).toContain('No baseline yet');
  });

  it('cannot be turned into markup, links or mentions by a test name', () => {
    const hostile = record(99, { tests: { 'x.ts :: `[a](http://evil.test) @octocat | <img src=x>`': 900 } });
    const past = record(1, { tests: { 'x.ts :: `[a](http://evil.test) @octocat | <img src=x>`': 100 } });
    const markdown = renderComparison(compareRecords(hostile, [past]), { record: hostile });
    const row = markdown.split('\n').find((line) => line.includes('evil'));
    expect(row).toBeDefined();
    expect(row).not.toMatch(/[`<>[\]@]/);
    expect(row?.split('|')).toHaveLength(6);
  });
});

describe('formatting', () => {
  it('formats seconds and sanitizes names', () => {
    expect(formatSeconds(45)).toBe('45s');
    expect(formatSeconds(125)).toBe('2m 05s');
    expect(safeName('a|b`c')).toBe('a?b?c');
    expect(safeName('x'.repeat(300))).toHaveLength(100);
  });
});
