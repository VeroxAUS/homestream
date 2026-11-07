import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GithubError } from '../../../../scripts/lib/github.mjs';
import { main, pullRequestOf } from '../../../../scripts/ci-timing.mjs';
import { makeTempDir, removeDir } from '../helpers.js';

const root = makeTempDir('ci-timing-main');
const remote = path.join(root, 'remote.git');
afterAll(() => removeDir(root));

const git = (args: string[], cwd = root) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 7, 10, 0, 0) + seconds * 1000).toISOString();

let updates = 0;

function fakeApi(runId: number, linuxSeconds: number) {
  const comments: Array<{ id: number; body: string; updated: number }> = [];
  const api = {
    comments,
    async paginate() {
      return comments.map((c) => ({ ...c }));
    },
    async request(method: string, route: string, body?: { body: string }) {
      if (route.endsWith(`/actions/runs/${runId}`)) {
        return {
          id: runId,
          run_attempt: 1,
          html_url: `https://github.test/runs/${runId}`,
          head_sha: 'b'.repeat(40),
          head_branch: 'main',
          event: 'push',
          run_started_at: at(runId * 1000),
        };
      }
      if (route.includes('/jobs')) {
        const start = runId * 1000;
        return {
          jobs: [
            {
              name: 'Linux',
              status: 'completed',
              conclusion: 'success',
              started_at: at(start + 5),
              completed_at: at(start + 5 + linuxSeconds),
              steps: [
                {
                  name: 'Install dependencies',
                  conclusion: 'success',
                  started_at: at(start + 6),
                  completed_at: at(start + 26),
                },
              ],
            },
            {
              name: 'CI timing',
              status: 'in_progress',
              conclusion: null,
              started_at: at(start + 700),
              completed_at: null,
              steps: [],
            },
          ],
        };
      }
      if (method === 'POST') {
        comments.push({ id: 500 + comments.length, body: body?.body ?? '', updated: ++updates });
        return {};
      }
      if (method === 'PATCH') {
        const comment = comments.find((c) => route.endsWith(`/${c.id}`));
        if (comment) Object.assign(comment, { body: body?.body ?? '', updated: ++updates });
        return {};
      }
      throw new Error(`unexpected ${method} ${route}`);
    },
  };
  return api;
}

function envFor(runId: number, extra: Record<string, string> = {}) {
  const summary = path.join(root, `summary-${runId}-${Math.random().toString(16).slice(2)}.md`);
  writeFileSync(summary, '');
  return {
    env: {
      GITHUB_TOKEN: 'ghs_test_token_value',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_RUN_ID: String(runId),
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF_NAME: 'main',
      GITHUB_STEP_SUMMARY: summary,
      METRICS_REMOTE: remote,
      ...extra,
    } as NodeJS.ProcessEnv,
    summary,
  };
}

const reportsDir = path.join(root, 'reports');
const metricsFiles = () =>
  git(['ls-tree', '-r', '--name-only', 'ci-metrics'], remote)
    .split('\n')
    .filter((name) => name.startsWith('runs/'));
const argsFor = (name: string) => [
  '--exclude-job',
  'CI timing',
  '--reports',
  reportsDir,
  '--metrics-dir',
  path.join(root, name),
];
let mainTip = '';

beforeAll(() => {
  git(['init', '--bare', '--initial-branch=main', remote]);
  const work = path.join(root, 'seed');
  mkdirSync(work);
  git(['init', '--initial-branch=main'], work);
  writeFileSync(path.join(work, 'app.txt'), 'code');
  git(['add', '.'], work);
  git(['commit', '-m', 'init'], work);
  git(['push', remote, 'main'], work);
  mainTip = git(['rev-parse', 'main'], remote);
  mkdirSync(reportsDir);
  writeFileSync(
    path.join(reportsDir, 'vitest.json'),
    JSON.stringify({
      testResults: [
        {
          name: '/w/apps/server/test/a.test.ts',
          assertionResults: [{ fullName: 'suite case', status: 'passed', duration: 80 }],
        },
      ],
    }),
  );
});

describe('ci-timing on main', () => {
  it('creates the orphan ci-metrics branch with exactly one record per run and never touches main', async () => {
    const first = envFor(1, {});
    expect(await main(argsFor('m1'), first.env, fakeApi(1, 300))).toBe(0);
    expect(metricsFiles()).toHaveLength(1);
    expect(git(['rev-list', '--max-parents=0', 'ci-metrics'], remote)).not.toBe(
      git(['rev-list', '--max-parents=0', 'main'], remote),
    );
    expect(readFileSync(first.summary, 'utf8')).toContain('No baseline yet');

    const second = envFor(2);
    expect(await main(argsFor('m2'), second.env, fakeApi(2, 400))).toBe(0);
    const files = metricsFiles();
    expect(files).toHaveLength(2);
    expect(files[0]).toContain('-1-1.json');
    expect(git(['rev-parse', 'main'], remote)).toBe(mainTip);

    const record = JSON.parse(git(['show', `ci-metrics:${files[1]}`], remote));
    expect(record.run.id).toBe(2);
    expect(record.jobs.map((job: { name: string }) => job.name)).toEqual(['Linux']);
    expect(record.jobs[0].steps[0]).toMatchObject({ name: 'Install dependencies', seconds: 20 });
    expect(record.tests).toEqual({ 'apps/server/test/a.test.ts :: suite case': 80 });
    expect(record.totalSeconds).toBe(405);
  });

  it('puts the comparison with the earlier main runs into the job summary', async () => {
    const third = envFor(3);
    expect(await main(argsFor('m3'), third.env, fakeApi(3, 450))).toBe(0);
    const summary = readFileSync(third.summary, 'utf8');
    expect(summary).toContain('median of the last 2 successful main run(s)');
    expect(summary).toContain('### Total');
    expect(summary).toContain('### Jobs and steps more than 20% slower');
    expect(summary).toContain('| Linux |');
    expect(summary).toContain('### Top regressed tests');
    expect(metricsFiles()).toHaveLength(3);
  });

  it('does not record the same run twice when it is run again', async () => {
    const again = envFor(3);
    expect(await main(argsFor('m3b'), again.env, fakeApi(3, 450))).toBe(0);
    expect(metricsFiles()).toHaveLength(3);
  });
});

describe('ci-timing on other main runs', () => {
  it('records a manually dispatched main run as well, exactly once', async () => {
    const before = metricsFiles();
    const dispatched = envFor(20, { GITHUB_EVENT_NAME: 'workflow_dispatch' });
    expect(await main(argsFor('d1'), dispatched.env, fakeApi(20, 300))).toBe(0);
    expect(metricsFiles()).toHaveLength(before.length + 1);
    const added = metricsFiles().filter((name) => !before.includes(name));
    expect(added).toHaveLength(1);
    expect(JSON.parse(git(['show', `ci-metrics:${added[0]}`], remote)).run.id).toBe(20);

    expect(
      await main(argsFor('d2'), envFor(20, { GITHUB_EVENT_NAME: 'workflow_dispatch' }).env, fakeApi(20, 300)),
    ).toBe(0);
    expect(metricsFiles()).toHaveLength(before.length + 1);
  });

  it('does not record a run of another branch', async () => {
    const before = metricsFiles();
    const other = envFor(21, { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_NAME: 'feature' });
    expect(await main(argsFor('d3'), other.env, fakeApi(21, 300))).toBe(0);
    expect(metricsFiles()).toEqual(before);
  });
});

describe('ci-timing on pull requests', () => {
  function eventFile(number: number, headRepo: string) {
    const file = path.join(root, `event-${number}-${headRepo.replace('/', '-')}.json`);
    writeFileSync(file, JSON.stringify({ pull_request: { number, head: { repo: { full_name: headRepo } } } }));
    return file;
  }

  it('posts one sticky comment and edits it in place on the next run, without writing to ci-metrics', async () => {
    const event = eventFile(9, 'owner/repo');
    const before = metricsFiles();
    const api = fakeApi(10, 500);
    const prEnv = (id: number) =>
      envFor(id, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF_NAME: '9/merge', GITHUB_EVENT_PATH: event }).env;
    expect(await main(argsFor('p1'), prEnv(10), api)).toBe(0);
    expect(api.comments).toHaveLength(1);
    expect(api.comments[0]?.body).toContain('<!-- homestream-ci-timing -->');
    const firstUpdate = api.comments[0]?.updated ?? 0;

    const second = fakeApi(11, 520);
    second.comments.push(...api.comments);
    expect(await main(argsFor('p2'), prEnv(11), second)).toBe(0);
    expect(second.comments).toHaveLength(1);
    expect(second.comments[0]?.updated).toBeGreaterThan(firstUpdate);
    expect(second.comments[0]?.body).toContain('Run [11]');
    expect(metricsFiles()).toEqual(before);
  });

  it('leaves the comment out for forks and for a read-only token, and still succeeds', async () => {
    const fork = fakeApi(12, 300);
    const forkEnv = envFor(12, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REF_NAME: '5/merge',
      GITHUB_EVENT_PATH: eventFile(5, 'someone/repo'),
    });
    expect(await main(argsFor('f1'), forkEnv.env, fork)).toBe(0);
    expect(fork.comments).toHaveLength(0);
    expect(readFileSync(forkEnv.summary, 'utf8')).toContain('## CI timing');

    const readOnly = fakeApi(13, 300);
    const original = readOnly.request.bind(readOnly);
    readOnly.request = async (method: string, route: string, body?: { body: string }) => {
      if (method === 'POST') throw new GithubError(method, route, 403, 'Resource not accessible by integration');
      return original(method, route, body);
    };
    const roEnv = envFor(13, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REF_NAME: '6/merge',
      GITHUB_EVENT_PATH: eventFile(6, 'owner/repo'),
    });
    expect(await main(argsFor('f2'), roEnv.env, readOnly)).toBe(0);
  });

  it('reads the pull request number and the fork flag from the event payload', () => {
    expect(pullRequestOf({ GITHUB_EVENT_PATH: eventFile(4, 'owner/repo'), GITHUB_REPOSITORY: 'owner/repo' })).toEqual({
      number: 4,
      fromFork: false,
    });
    expect(pullRequestOf({ GITHUB_REPOSITORY: 'owner/repo' })).toBeNull();
  });

  it('fails clearly when the environment is incomplete', async () => {
    expect(await main([], {} as NodeJS.ProcessEnv)).toBe(1);
  });
});
