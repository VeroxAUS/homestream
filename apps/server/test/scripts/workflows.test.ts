import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const workflowsDir = path.join(root, '.github', 'workflows');

interface Step {
  uses?: string;
  run?: string;
  name?: string;
  if?: string;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  'runs-on'?: string;
  'timeout-minutes'?: number;
  'continue-on-error'?: boolean;
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  steps?: Step[];
}
interface Workflow {
  name: string;
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: { group: string; 'cancel-in-progress'?: boolean };
  jobs: Record<string, Job>;
}

const files = readdirSync(workflowsDir).filter((name) => name.endsWith('.yml'));
const texts = new Map(files.map((name) => [name, readFileSync(path.join(workflowsDir, name), 'utf8')]));
const workflows = new Map(files.map((name) => [name, parse(texts.get(name) ?? '') as Workflow]));
const jobsOf = (name: string) => Object.entries(workflows.get(name)?.jobs ?? {});

describe('workflow hygiene', () => {
  it('has the workflows the repository relies on', () => {
    for (const name of [
      'ci.yml',
      'codeql.yml',
      'gitleaks.yml',
      'release.yml',
      'sentry-issues.yml',
      'docs.yml',
      'devcontainer.yml',
      'droid-wiki-refresh.yml',
      'droid-review.yml',
      'code-health.yml',
    ]) {
      expect(files).toContain(name);
    }
  });

  it.each(files)('%s declares least-privilege permissions at the top and a timeout on every job', (name) => {
    const workflow = workflows.get(name);
    expect(workflow?.permissions, `${name} permissions`).toEqual({ contents: 'read' });
    for (const [id, job] of jobsOf(name)) {
      expect(job['timeout-minutes'] ?? 0, `${name}:${id} timeout-minutes`).toBeGreaterThan(0);
    }
  });

  it.each(files)('%s pins every action to a full commit SHA or a major tag', (name) => {
    const uses = jobsOf(name).flatMap(([, job]) => (job.steps ?? []).flatMap((step) => (step.uses ? [step.uses] : [])));
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) {
      expect(action, `${name}: ${action}`).toMatch(/@([0-9a-f]{40}|v\d+)$/);
    }
  });

  it('never uses pull_request_target', () => {
    for (const [name, text] of texts) expect(text, name).not.toContain('pull_request_target');
  });

  it('CI runs on push to main, pull requests and manual dispatch, cancels superseded runs and skips wiki-only changes', () => {
    const ci = workflows.get('ci.yml');
    expect(Object.keys(ci?.on ?? {}).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch']);
    expect(ci?.concurrency?.['cancel-in-progress']).toBe(true);
    const on = ci?.on as {
      push: { branches: string[]; 'paths-ignore': string[] };
      pull_request: { 'paths-ignore': string[] };
    };
    expect(on.push.branches).toEqual(['main']);
    expect(on.push['paths-ignore']).toContain('droid-wiki/**');
    expect(on.pull_request['paths-ignore']).toContain('droid-wiki/**');
  });

  it('CI has the Linux and Windows jobs that branch protection requires, with those exact names', () => {
    const jobs = Object.fromEntries(jobsOf('ci.yml'));
    expect(jobs.linux?.name).toBe('Linux');
    expect(jobs.linux?.['runs-on']).toBe('ubuntu-latest');
    expect(jobs.windows?.name).toBe('Windows');
    expect(jobs.windows?.['runs-on']).toBe('windows-latest');
    const wiki = readFileSync(path.join(workflowsDir, 'droid-wiki-refresh.yml'), 'utf8');
    expect(wiki).toContain('REQUIRED_CHECKS: Linux,Windows');
  });

  it('the Linux job runs every readiness check as its own step, never GPU or live tests', () => {
    const run = (jobsOf('ci.yml').find(([id]) => id === 'linux')?.[1].steps ?? [])
      .map((step) => step.run ?? '')
      .join('\n');
    for (const command of [
      'pnpm format:check',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm knip',
      'pnpm dup',
      'pnpm deps:check',
      'pnpm syncpack:lint',
      'pnpm agents:check',
      'pnpm docs:check',
      'pnpm openapi:check',
      'pnpm db:schema:check',
      'pnpm flags:check',
      'pnpm techdebt',
      'envExample.test.ts',
      'pnpm test:coverage',
      'test-report.mjs --merge-only',
      'gitleaks git',
    ]) {
      expect(run, command).toContain(command);
    }
    expect(run).not.toMatch(/test:gpu|test:live/);
    expect(texts.get('ci.yml')).toContain('name: test-reports');
    expect(texts.get('ci.yml')).not.toContain('secrets.');
  });

  it('the Windows job runs the named server unit-test subset', () => {
    const run = (jobsOf('ci.yml').find(([id]) => id === 'windows')?.[1].steps ?? [])
      .map((step) => step.run ?? '')
      .join('\n');
    for (const file of ['config', 'redact', 'playlist', 'decision', 'ffmpegArgs', 'db'])
      expect(run).toContain(`${file}.test.ts`);
    expect(run).toContain('pnpm typecheck');
  });

  it('references secrets only where they are needed', () => {
    const allowed: Record<string, string[]> = {
      'release.yml': ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG'],
      'sentry-issues.yml': ['SENTRY_API_TOKEN', 'SENTRY_ORG'],
      'droid-wiki-refresh.yml': ['FACTORY_API_KEY', 'FACTORY_WIKI_PR_TOKEN'],
      'droid-review.yml': ['FACTORY_API_KEY'],
      'code-health.yml': ['FACTORY_API_KEY'],
    };
    for (const [name, text] of texts) {
      const used = new Set([...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]));
      used.delete('GITHUB_TOKEN');
      for (const secret of used) expect(allowed[name] ?? [], `${name} uses ${secret}`).toContain(secret);
    }
  });

  it('the release workflow follows CI on main, creates a release and a Sentry release, and writes nothing to the repository', () => {
    const text = texts.get('release.yml') ?? '';
    expect(workflows.get('release.yml')?.on).toHaveProperty('workflow_run');
    expect(text).toContain('scripts/next-version.mjs');
    expect(text).toContain('--generate-notes');
    expect(text).toContain('getsentry/action-release');
    expect(text).toContain('release: homestream@');
    expect(text).toContain('set_commits');
    expect(text).not.toMatch(/git push|git commit|gh pr create|pull-requests:\s*write/);
  });

  it('scheduled workflows have a manual trigger too', () => {
    for (const name of ['sentry-issues.yml', 'devcontainer.yml', 'codeql.yml', 'gitleaks.yml', 'code-health.yml']) {
      expect(Object.keys(workflows.get(name)?.on ?? {}), name).toEqual(
        expect.arrayContaining(['schedule', 'workflow_dispatch']),
      );
    }
  });

  it('keeps the wiki workflow split: a read-only generate job and a publishing job with auto-merge', () => {
    const wiki = texts.get('droid-wiki-refresh.yml') ?? '';
    expect(wiki).toContain('schedule:');
    expect(wiki).toContain('--squash --auto');
    const jobs = Object.fromEntries(jobsOf('droid-wiki-refresh.yml')) as Record<
      string,
      { permissions?: Record<string, string> }
    >;
    expect(jobs['wiki-refresh']?.permissions).toEqual({ contents: 'read' });
    expect(jobs['wiki-publish']?.permissions).toMatchObject({ contents: 'write', 'pull-requests': 'write' });
  });

  it('the CI timing job runs after the required jobs, can never fail the run and is not a required check', () => {
    const jobs = Object.fromEntries(jobsOf('ci.yml'));
    const timing = jobs.timing;
    expect(timing?.needs).toEqual(expect.arrayContaining(['linux', 'windows']));
    expect(timing?.if).toContain('!cancelled()');
    expect(timing?.['continue-on-error']).toBe(true);
    expect(['Linux', 'Windows']).not.toContain(timing?.name);
    expect(jobs.linux?.needs).toBeUndefined();
    expect(jobs.windows?.needs).toBeUndefined();
    const run = (timing?.steps ?? []).map((step) => step.run ?? '').join('\n');
    expect(run).toContain('scripts/ci-timing.mjs');
    expect(texts.get('ci.yml')).not.toContain('secrets.');
  });

  it('the Droid review is advisory: same-repo pull requests only, forks and Dependabot skip with a notice, pushes use droid exec', () => {
    const workflow = workflows.get('droid-review.yml');
    expect(workflow?.on).toHaveProperty('pull_request');
    expect(workflow?.on).toHaveProperty('push');
    const jobs = Object.fromEntries(jobsOf('droid-review.yml'));
    expect(jobs['pr-review']?.['continue-on-error']).toBe(true);
    expect(jobs['pr-review']?.if).toContain('head.repo.full_name == github.repository');
    expect(jobs['pr-review']?.if).toContain('dependabot[bot]');
    expect(jobs['pr-review']?.steps?.some((step) => step.uses?.startsWith('Factory-AI/droid-action@'))).toBe(true);
    const skip = (jobs['skip-notice']?.steps ?? []).map((step) => step.run ?? '').join('\n');
    const action = jobs['pr-review']?.steps?.find((step) => step.uses?.startsWith('Factory-AI/droid-action@'));
    expect(action?.with).toMatchObject({ automatic_review: true, use_sticky_comment: true });
    expect(skip).toContain('::notice');
    expect(jobs['push-review']?.['continue-on-error']).toBe(true);
    expect(jobs['push-review']?.if).toBe("github.event_name == 'push'");
    const push = (jobs['push-review']?.steps ?? []).map((step) => step.run ?? '').join('\n');
    expect(push).toContain('scripts/droid-push-review.mjs');
  });

  it('the Droid comment cleanup is its own advisory job after the review, so it runs from the merge commit', () => {
    const job = workflows.get('droid-review.yml')?.jobs['pr-review-cleanup'];
    expect(job?.needs).toBe('pr-review');
    expect(job?.['continue-on-error']).toBe(true);
    const run = (job?.steps ?? []).map((step) => step.run ?? '').join('\n');
    expect(run).toContain('scripts/droid-pr-cleanup.mjs');
  });

  it('the daily code-health review only comments on the issue: no code pushes, no pull requests, one run at a time', () => {
    const text = texts.get('code-health.yml') ?? '';
    expect(text).not.toMatch(/git push|git commit|gh pr create|pull-requests:\s*write|contents:\s*write/);
    const workflow = workflows.get('code-health.yml');
    expect(workflow?.concurrency).toEqual({ group: 'code-health', 'cancel-in-progress': false });
    const job = workflow?.jobs.review;
    expect(job?.permissions).toEqual({ contents: 'read', issues: 'write' });
    const steps = job?.steps ?? [];
    const review = steps.find((step) => step.run?.includes('code-health.mjs review'));
    expect(review?.if).toBe("steps.plan.outputs.should_run == 'true'");
    expect(steps.some((step) => step.run?.includes('code-health.mjs plan'))).toBe(true);
  });
});
