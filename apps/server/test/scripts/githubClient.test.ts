import { describe, expect, it } from 'vitest';
import {
  GithubError,
  clampBody,
  githubClient,
  neutralizeMentions,
  redactValues,
  upsertMarkedComment,
} from '../../../../scripts/lib/github.mjs';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(responses: Response[]) {
  const calls: Array<{ url: string; method: string; body?: string; auth?: string }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body as string | undefined,
      auth: headers.authorization,
    });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('githubClient', () => {
  it('expands {repo}, sends the token and a JSON body', async () => {
    const { impl, calls } = fakeFetch([json({ id: 1 })]);
    const github = githubClient({ token: 'tok', repository: 'o/r', fetchImpl: impl, base: 'https://api.example.test' });
    await github.request('POST', '{repo}/issues', { title: 'x' });
    expect(calls[0]).toMatchObject({
      url: 'https://api.example.test/repos/o/r/issues',
      method: 'POST',
      body: '{"title":"x"}',
      auth: 'Bearer tok',
    });
  });

  it('retries a 502 and then succeeds, but not a 404', async () => {
    const retry = fakeFetch([json({ message: 'bad gateway' }, 502), json({ ok: true })]);
    const github = githubClient({ token: 't', repository: 'o/r', fetchImpl: retry.impl, sleepImpl: async () => {} });
    await expect(github.request('GET', '{repo}')).resolves.toEqual({ ok: true });
    expect(retry.calls).toHaveLength(2);

    const missing = fakeFetch([json({ message: 'Not Found' }, 404)]);
    const other = githubClient({ token: 't', repository: 'o/r', fetchImpl: missing.impl, sleepImpl: async () => {} });
    const error = await other.request('GET', '{repo}/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GithubError);
    expect((error as GithubError).status).toBe(404);
    expect(missing.calls).toHaveLength(1);
  });

  it('gives up after three attempts on a persistent 503', async () => {
    const { impl, calls } = fakeFetch([json({}, 503), json({}, 503), json({}, 503)]);
    const github = githubClient({ token: 't', repository: 'o/r', fetchImpl: impl, sleepImpl: async () => {} });
    await expect(github.request('GET', '{repo}')).rejects.toThrow('503');
    expect(calls).toHaveLength(3);
  });

  it('reads every page until a short page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const { impl, calls } = fakeFetch([json(full), json([{ id: 100 }])]);
    const github = githubClient({ token: 't', repository: 'o/r', fetchImpl: impl });
    const all = await github.paginate('{repo}/issues?state=open');
    expect(all).toHaveLength(101);
    expect(calls[1]?.url).toContain('state=open&per_page=100&page=2');
  });
});

describe('text helpers', () => {
  it('breaks @mentions but keeps e-mail-like text and code spans', () => {
    expect(neutralizeMentions('ping @octocat and @org/team, mail a@b.test, `@scoped/pkg`')).toBe(
      'ping @\u200boctocat and @\u200borg/team, mail a@b.test, `@scoped/pkg`',
    );
  });

  it('clamps long bodies and keeps short ones', () => {
    expect(clampBody('short')).toBe('short');
    const clamped = clampBody('x'.repeat(100), 80);
    expect(clamped.length).toBeLessThanOrEqual(120);
    expect(clamped).toContain('Truncated');
  });

  it('redacts secret values and ignores empty or short ones', () => {
    expect(redactValues('token is abcdefgh1234 and abc', ['abcdefgh1234', undefined, 'abc'])).toBe(
      'token is *** and abc',
    );
  });
});

describe('upsertMarkedComment', () => {
  function fakeIssue(initial: Array<{ id: number; body: string }>) {
    const comments = [...initial];
    let nextId = 100;
    return {
      comments,
      paginate: async () => comments.map((c) => ({ ...c })),
      request: async (method: string, route: string, body?: unknown) => {
        const id = Number(/comments\/(\d+)/.exec(route)?.[1]);
        const text = (body as { body?: string } | undefined)?.body ?? '';
        if (method === 'POST') {
          comments.push({ id: nextId, body: text });
          return { id: nextId++ };
        }
        const index = comments.findIndex((c) => c.id === id);
        if (method === 'DELETE') comments.splice(index, 1);
        else if (comments[index]) comments[index].body = text;
        return { id };
      },
    };
  }

  it('creates the comment once and edits it in place afterwards', async () => {
    const issue = fakeIssue([{ id: 1, body: 'someone else' }]);
    await upsertMarkedComment(issue, 7, '<!-- m -->', '<!-- m -->\nfirst');
    await upsertMarkedComment(issue, 7, '<!-- m -->', '<!-- m -->\nsecond');
    expect(issue.comments.filter((c) => c.body.includes('<!-- m -->'))).toEqual([
      { id: 100, body: '<!-- m -->\nsecond' },
    ]);
    expect(issue.comments).toHaveLength(2);
  });

  it('removes extra copies so exactly one comment remains', async () => {
    const issue = fakeIssue([
      { id: 5, body: '<!-- m --> old' },
      { id: 6, body: '<!-- m --> copy' },
    ]);
    await upsertMarkedComment(issue, 7, '<!-- m -->', '<!-- m --> new');
    expect(issue.comments).toEqual([{ id: 5, body: '<!-- m --> new' }]);
  });
});
