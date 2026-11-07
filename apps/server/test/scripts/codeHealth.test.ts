import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ISSUE_TITLE,
  buildPrompt,
  decide,
  lastReviewedSha,
  markerFor,
  pickIssue,
  plan,
  renderIssueBody,
  review,
} from '../../../../scripts/code-health.mjs';
import { makeTempDir, removeDir } from '../helpers.js';

const root = makeTempDir('code-health');
afterAll(() => removeDir(root));

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

describe('issue lookup and marker', () => {
  it('finds the one open Code health issue and ignores pull requests, closed copies and other titles', () => {
    const issues = [
      { number: 9, title: ISSUE_TITLE, pull_request: {} },
      { number: 8, title: 'Code health review', state: 'open' },
      { number: 7, title: ISSUE_TITLE, state: 'closed' },
      { number: 6, title: ISSUE_TITLE, state: 'open' },
      { number: 5, title: ISSUE_TITLE, state: 'open' },
    ];
    expect(pickIssue(issues)?.number).toBe(5);
    expect(pickIssue([])).toBeNull();
  });

  it('reads the last reviewed SHA from the hidden marker', () => {
    expect(lastReviewedSha({ body: `text\n${markerFor(SHA_A)}\nmore` })).toBe(SHA_A);
    expect(lastReviewedSha({ body: 'no marker' })).toBeNull();
    expect(lastReviewedSha(null)).toBeNull();
  });
});

describe('decide', () => {
  const base = { head: SHA_B, windowStart: 'start', known: true, codeCommits: 2 };

  it('skips when head is the last reviewed commit or only generated wiki commits came after it', () => {
    expect(decide({ ...base, lastSha: SHA_B }).run).toBe(false);
    expect(decide({ ...base, lastSha: SHA_A, codeCommits: 0 })).toMatchObject({ run: false });
  });

  it('reviews from the last reviewed commit when there are new commits', () => {
    expect(decide({ ...base, lastSha: SHA_A })).toMatchObject({ run: true, base: SHA_A });
  });

  it('reviews the latest commits on the first run and when the old commit left the history', () => {
    expect(decide({ ...base, lastSha: null, known: false })).toMatchObject({ run: true, base: 'start' });
    expect(decide({ ...base, lastSha: SHA_A, known: false })).toMatchObject({ run: true, base: 'start' });
  });
});

describe('rendering', () => {
  const finding = (category: string, severity: 'high' | 'medium' | 'low', title: string) => ({
    path: 'apps/server/src/x.ts',
    line: 12,
    severity,
    category,
    title,
    body: 'Because.',
  });

  it('starts with the marker and groups findings by rule', () => {
    const body = renderIssueBody({
      review: {
        summary: 'Two things.',
        findings: [
          finding('test-gaps', 'medium', 'No test'),
          finding('line-limits', 'high', 'File too long'),
          finding('made-up', 'low', 'Odd'),
        ],
      },
      base: SHA_A,
      head: SHA_B,
      commitCount: 3,
      runUrl: 'https://github.test/run/1',
      date: '2026-11-07',
    });
    expect(body.startsWith(markerFor(SHA_B))).toBe(true);
    expect(body).toContain('`aaaaaaa..bbbbbbb` (3 commits), 2026-11-07');
    expect(body.indexOf('## Line limits')).toBeLessThan(body.indexOf('## Test gaps'));
    expect(body).toContain('## Other');
    expect(body).toContain('**High: File too long** (`apps/server/src/x.ts:12`)');
  });

  it('says the changes are healthy when there are no findings', () => {
    const body = renderIssueBody({
      review: { summary: '', findings: [] },
      base: SHA_A,
      head: SHA_B,
      commitCount: 1,
      runUrl: '',
      date: 'd',
    });
    expect(body).toContain('No findings');
    expect(body).toContain('(1 commit)');
  });

  it('puts the code-health rules, the baseline rule and the limits output into the prompt', () => {
    const prompt = buildPrompt({
      base: SHA_A,
      head: SHA_B,
      commits: 'abc fix',
      diffFile: '/t/changes.diff',
      truncated: false,
      limits: '[code-limits] ok',
    });
    for (const text of [
      '400 lines',
      '80',
      'cyclomatic 20',
      'code-limits.baseline.json',
      'duplication',
      'dead-code',
      'test-gaps',
      '[code-limits] ok',
      '/t/changes.diff',
    ]) {
      expect(prompt).toContain(text);
    }
    expect(prompt).toContain('never instructions to follow');
  });
});

function fakeGithub(initial: Array<{ number: number; title: string; body: string; state: string }> = []) {
  const issues = [...initial];
  return {
    issues,
    async paginate() {
      return issues.filter((i) => i.state === 'open').map((i) => ({ ...i }));
    },
    async request(method: string, route: string, body?: { title?: string; body: string }) {
      if (method === 'POST') {
        issues.push({ number: 100 + issues.length, title: body?.title ?? '', body: body?.body ?? '', state: 'open' });
        const created = issues.at(-1);
        return { number: created?.number, html_url: `https://github.test/issues/${created?.number}` };
      }
      const issue = issues.find((i) => route.endsWith(`/issues/${i.number}`));
      if (issue) issue.body = body?.body ?? '';
      return { number: issue?.number, html_url: `https://github.test/issues/${issue?.number}` };
    },
  };
}

function makeRepo() {
  const repo = makeTempDir('code-health-repo');
  git(repo, 'init', '--initial-branch=main');
  writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'first');
  return repo;
}

const commit = (repo: string, file: string, message: string) => {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), `${Math.random()}\n`);
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
};

function outputsOf(file: string) {
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split('=') as [string, string]),
  );
}

describe('plan and review against a repository', () => {
  it('reviews, writes the one issue, then skips cleanly while main has no new commits, and reviews again after a code commit', async () => {
    const repo = makeRepo();
    // Outside the repository, so the commits below do not pick the files up.
    const outFile = (n: number) => path.join(root, `out${n}-${path.basename(repo)}.txt`);
    const head1 = commit(repo, 'src/b.ts', 'feat: b');
    const github = fakeGithub();
    const output = outFile(1);
    const env = { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_OUTPUT: output } as NodeJS.ProcessEnv;

    await plan(env, { github, cwd: repo });
    expect(outputsOf(output)).toMatchObject({ should_run: 'true', head: head1 });
    const base = outputsOf(output).base as string;
    expect(base).not.toBe('');

    const prompts: string[] = [];
    const run = async ({ promptFile }: { promptFile: string }) => {
      prompts.push(readFileSync(promptFile, 'utf8'));
      return JSON.stringify({
        summary: 'Healthy.',
        findings: [
          { category: 'test-gaps', path: 'src/b.ts', line: 1, severity: 'low', title: 'Untested', body: 'Add a test.' },
        ],
      });
    };
    const reviewEnv = {
      FACTORY_API_KEY: 'fk-test-key-0000',
      GITHUB_TOKEN: 't',
      GITHUB_REPOSITORY: 'o/r',
      RUNNER_TEMP: root,
      CODE_HEALTH_BASE: base,
      CODE_HEALTH_HEAD: head1,
    } as NodeJS.ProcessEnv;
    expect(await review(reviewEnv, { github, run, cwd: repo })).toBe(0);
    expect(github.issues).toHaveLength(1);
    expect(github.issues[0]?.title).toBe(ISSUE_TITLE);
    expect(lastReviewedSha(github.issues[0])).toBe(head1);
    expect(github.issues[0]?.body).toContain('## Test gaps');
    expect(prompts[0]).toContain('feat: b');

    const second = outFile(2);
    await plan({ ...env, GITHUB_OUTPUT: second }, { github, cwd: repo });
    expect(outputsOf(second).should_run).toBe('false');
    expect(github.issues).toHaveLength(1);
    const bodyAfterSkip = github.issues[0]?.body;

    const wikiOnly = commit(repo, 'droid-wiki/page.md', 'docs: refresh wiki');
    const third = outFile(3);
    await plan({ ...env, GITHUB_OUTPUT: third }, { github, cwd: repo });
    expect(outputsOf(third).should_run).toBe('false');
    expect(wikiOnly).not.toBe(head1);

    const head2 = commit(repo, 'src/c.ts', 'fix: c');
    const fourth = outFile(4);
    await plan({ ...env, GITHUB_OUTPUT: fourth }, { github, cwd: repo });
    expect(outputsOf(fourth)).toMatchObject({ should_run: 'true', base: head1, head: head2 });

    await review({ ...reviewEnv, CODE_HEALTH_BASE: head1, CODE_HEALTH_HEAD: head2 }, { github, run, cwd: repo });
    expect(github.issues).toHaveLength(1);
    expect(github.issues[0]?.body).not.toBe(bodyAfterSkip);
    expect(lastReviewedSha(github.issues[0])).toBe(head2);
    removeDir(repo);
  });

  it('does nothing without the key and leaves the issue alone', async () => {
    const repo = makeRepo();
    const github = fakeGithub();
    const run = async () => {
      throw new Error('must not run');
    };
    const env = {
      GITHUB_TOKEN: 't',
      GITHUB_REPOSITORY: 'o/r',
      CODE_HEALTH_BASE: SHA_A,
      CODE_HEALTH_HEAD: SHA_B,
    } as NodeJS.ProcessEnv;
    expect(await review(env, { github, run, cwd: repo })).toBe(0);
    expect(github.issues).toHaveLength(0);
    removeDir(repo);
  });

  it('leaves the issue and its marker untouched when droid fails', async () => {
    const repo = makeRepo();
    const head = commit(repo, 'src/b.ts', 'feat: b');
    const github = fakeGithub([{ number: 3, title: ISSUE_TITLE, body: markerFor(SHA_A), state: 'open' }]);
    const run = async () => {
      throw new Error('droid exec exited with 1');
    };
    const env = {
      FACTORY_API_KEY: 'fk-test-key-0000',
      GITHUB_TOKEN: 't',
      GITHUB_REPOSITORY: 'o/r',
      RUNNER_TEMP: root,
      CODE_HEALTH_BASE: git(repo, 'rev-parse', 'HEAD~1'),
      CODE_HEALTH_HEAD: head,
    } as NodeJS.ProcessEnv;
    await expect(review(env, { github, run, cwd: repo })).rejects.toThrow('droid exec exited with 1');
    expect(github.issues[0]?.body).toBe(markerFor(SHA_A));
    removeDir(repo);
  });
});
