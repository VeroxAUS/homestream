import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  areaLabel,
  isSmokeError,
  issueBody,
  issueTitle,
  main,
  planIssues,
  scrub,
  type SentryIssueLike,
} from '../../../../scripts/sentry-issues.mjs';

const issue = (overrides: Partial<SentryIssueLike> = {}): SentryIssueLike => ({
  shortId: 'HOMESTREAM-SERVER-7',
  title: 'Error: encoder exited',
  culprit: 'sessionManager',
  level: 'error',
  count: '3',
  firstSeen: '2026-11-06T10:00:00Z',
  lastSeen: '2026-11-06T11:00:00Z',
  permalink: 'https://example-org.sentry.io/issues/123/',
  project: { slug: 'homestream-server' },
  metadata: { type: 'Error', value: 'encoder exited' },
  ...overrides,
});

describe('smoke error filter', () => {
  it('skips issues whose title, type, value or culprit is HomestreamReadinessSmokeError', () => {
    expect(isSmokeError(issue({ title: 'HomestreamReadinessSmokeError: telemetry smoke test' }))).toBe(true);
    expect(isSmokeError(issue({ metadata: { type: 'HomestreamReadinessSmokeError' } }))).toBe(true);
    expect(isSmokeError(issue({ metadata: { value: 'HomestreamReadinessSmokeError: x' } }))).toBe(true);
    expect(isSmokeError(issue({ culprit: 'HomestreamReadinessSmokeError' }))).toBe(true);
    expect(isSmokeError(issue())).toBe(false);
  });

  it('plans no GitHub issue for a smoke error and one for a real error', () => {
    const smoke = issue({ shortId: 'HOMESTREAM-SERVER-1', title: 'HomestreamReadinessSmokeError: x' });
    const plan = planIssues([smoke, issue()], []);
    expect(plan.skipped.smoke).toBe(1);
    expect(plan.create.map((draft) => draft.title)).toEqual(['[HOMESTREAM-SERVER-7] Error: encoder exited']);
  });
});

describe('planIssues', () => {
  it('labels with sentry, type:bug and the area of the project', () => {
    const [draft] = planIssues([issue({ project: { slug: 'homestream-web' } })], []).create;
    expect(draft?.labels).toEqual(['sentry', 'type:bug', 'area:web']);
    expect(areaLabel(issue({ project: { slug: 'homestream-tv' } }))).toBe('area:tv');
    expect(areaLabel(issue({ project: { slug: 'homestream-desktop' } }))).toBe('area:desktop');
    expect(areaLabel(issue({ project: { slug: 'other' } }))).toBe('area:server');
  });

  it('does not create an issue again when the short id is already in a GitHub title, open or closed', () => {
    const existing = [{ title: '[HOMESTREAM-SERVER-7] Error: encoder exited' }, { title: 'Unrelated' }];
    const plan = planIssues([issue(), issue({ shortId: 'HOMESTREAM-SERVER-8' })], existing);
    expect(plan.skipped.duplicate).toBe(1);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]?.title).toContain('HOMESTREAM-SERVER-8');
  });

  it('creates one issue for a short id that appears twice in the same response', () => {
    expect(planIssues([issue(), issue()], []).create).toHaveLength(1);
  });
});

describe('scrubbing', () => {
  it('removes URLs, tokens, keys and addresses from the text that reaches GitHub', () => {
    const text =
      'GET https://gw.example.test/stremio/abc/def/manifest.json?token=zzz failed for 203.0.113.9 with Bearer abcdef123456 and sntryu_abcdefghijklmnop and phc_abcdefghijklmnop';
    const clean = scrub(text);
    for (const secret of ['gw.example.test', 'abc/def', 'zzz', '203.0.113.9', 'abcdef123456', 'sntryu_', 'phc_']) {
      expect(clean).not.toContain(secret);
    }
    expect(clean).toContain('<url>');
  });

  it('builds a body with the Sentry link and no secret', () => {
    const body = issueBody(issue({ metadata: { value: 'failed token=hunter2hunter2 at 203.0.113.9' } }));
    expect(body).toContain('https://example-org.sentry.io/issues/123/');
    expect(body).toContain('Fixes HOMESTREAM-SERVER-7');
    expect(body).not.toContain('hunter2');
    expect(body).not.toContain('203.0.113.9');
    expect(issueTitle(issue())).toBe('[HOMESTREAM-SERVER-7] Error: encoder exited');
  });
});

describe('main', () => {
  afterEach(() => vi.restoreAllMocks());

  const env = { SENTRY_API_TOKEN: 'st', SENTRY_ORG: 'org', GITHUB_TOKEN: 'gt', GITHUB_REPOSITORY: 'o/r' };

  function stubFetch(sentry: SentryIssueLike[], github: Array<{ title: string }>) {
    const created: unknown[] = [];
    const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
      if (target.startsWith('https://us.sentry.io/api/0/organizations/org/issues/')) return json(sentry);
      if (init?.method === 'POST') {
        created.push(JSON.parse(String(init.body)));
        return json({ number: 1 });
      }
      return json(github);
    });
    return { impl: impl as unknown as typeof fetch, created };
  }

  it('creates the missing issues, skips smoke errors and duplicates, and does nothing on a second run', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const smoke = issue({ shortId: 'HOMESTREAM-SERVER-1', title: 'HomestreamReadinessSmokeError: x' });
    const first = stubFetch([smoke, issue()], []);
    expect(await main([], env, first.impl)).toBe(0);
    expect(first.created).toHaveLength(1);
    const second = stubFetch([smoke, issue()], [{ title: '[HOMESTREAM-SERVER-7] Error: encoder exited' }]);
    expect(await main([], env, second.impl)).toBe(0);
    expect(second.created).toHaveLength(0);
  });

  it('--dry-run creates nothing and a missing variable is reported', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = stubFetch([issue()], []);
    expect(await main(['--dry-run'], env, run.impl)).toBe(0);
    expect(run.created).toHaveLength(0);
    expect(await main([], { ...env, SENTRY_API_TOKEN: '' }, run.impl)).toBe(1);
  });
});
