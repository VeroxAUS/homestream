import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPlan,
  covers,
  createClient,
  loadRules,
  main,
  parseArgs,
  run,
  type AlertRules,
  type SentryClient,
} from '../../../../scripts/sentry-alerts.mjs';
import { makeTempDir, removeDir } from '../helpers.js';

const realRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const dirs: string[] = [];

interface Item {
  id: string;
  name: string;
  projectId?: string | null;
  detectorIds?: string[];
  [key: string]: unknown;
}

const RULES: AlertRules = {
  organization: 'acme',
  detectors: [{ name: 'Error Monitor', project: 'server', enabled: true }],
  workflows: [
    {
      name: 'New issue',
      project: 'server',
      detectors: ['Issue Stream'],
      enabled: true,
      triggers: { logicType: 'any-short', conditions: [{ type: 'first_seen_event', comparison: true }] },
    },
  ],
};

/** An in-memory Sentry that behaves like the new alerting API: workflows can be created, detectors cannot. */
function fakeSentry(initial: { detectors?: Item[]; workflows?: Item[] } = {}) {
  const state = {
    detectors: initial.detectors ?? [
      { id: '1', name: 'Error Monitor', projectId: '10', enabled: true },
      { id: '2', name: 'Issue Stream', projectId: '10', enabled: true },
    ],
    workflows: initial.workflows ?? [],
    calls: [] as string[],
    detectorWritable: false,
  };
  const client: SentryClient = {
    get: (resource: string) => {
      state.calls.push(`GET ${resource}`);
      if (resource === 'projects/') return Promise.resolve([{ slug: 'server', id: 10 }]);
      return Promise.resolve(resource === 'detectors/' ? state.detectors : state.workflows);
    },
    post: (resource: string, body: unknown) => {
      state.calls.push(`POST ${resource}`);
      if (resource === 'detectors/') return Promise.reject(new Error('POST detectors/ answered 405: nope'));
      const created = { id: String(100 + state.workflows.length), ...(body as object) } as Item;
      state.workflows.push(created);
      return Promise.resolve(created);
    },
    put: (resource: string, body: unknown) => {
      state.calls.push(`PUT ${resource}`);
      if (resource.startsWith('detectors/')) return Promise.reject(new Error('PUT detectors/1/ answered 403: no'));
      const id = resource.split('/')[1];
      const index = state.workflows.findIndex((item) => item.id === id);
      state.workflows[index] = { ...state.workflows[index], ...(body as object) } as Item;
      return Promise.resolve(state.workflows[index]);
    },
  };
  return { state, client };
}

function rulesFile(rules: unknown): string {
  const dir = makeTempDir('sentry-alerts');
  dirs.push(dir);
  mkdirSync(path.join(dir, 'monitoring', 'sentry'), { recursive: true });
  const file = path.join(dir, 'monitoring', 'sentry', 'alert-rules.json');
  writeFileSync(file, JSON.stringify(rules));
  return dir;
}

afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  for (const dir of dirs) removeDir(dir);
});

describe('sentry-alerts rules file', () => {
  it('the committed rules file is valid and targets the server project', () => {
    const rules = loadRules(path.join(realRoot, 'monitoring', 'sentry', 'alert-rules.json'));
    expect(rules.organization).toBe('<your-sentry-org>');
    expect([...rules.detectors, ...rules.workflows].every((rule) => rule.project === 'homestream-server')).toBe(true);
    expect(rules.workflows.length).toBeGreaterThan(0);
  });

  it('rejects a file with duplicate names or missing fields', () => {
    const bad = rulesFile({ workflows: [{ name: 'a', project: 'p' }, { name: 'a', project: 'p' }, { project: 'p' }] });
    expect(() => loadRules(path.join(bad, 'monitoring', 'sentry', 'alert-rules.json'))).toThrow(
      /"organization" is missing; duplicate workflows entry "a"/,
    );
  });

  it('parses arguments: exactly one of --dry-run or --apply', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ apply: false, file: undefined });
    expect(parseArgs(['--apply', '--file=x.json'])).toEqual({ apply: true, file: 'x.json' });
    expect(parseArgs([])).toBeNull();
    expect(parseArgs(['--apply', '--dry-run'])).toBeNull();
    expect(parseArgs(['--apply', '--other'])).toBeNull();
  });

  it('covers() ignores extra fields on the actual side but not different values or lengths', () => {
    expect(covers({ a: 1, b: { c: [1, 2], d: 3 }, id: 'x' }, { a: 1, b: { c: [1, 2] } })).toBe(true);
    expect(covers({ a: 1 }, { a: 2 })).toBe(false);
    expect(covers({ list: [1, 2, 3] }, { list: [1, 2] })).toBe(false);
    expect(covers(null, { a: 1 })).toBe(false);
    expect(covers({ list: 'x' }, { list: [1] })).toBe(false);
  });
});

describe('sentry-alerts plan and apply', () => {
  it('a dry run lists what would be created and changes nothing', async () => {
    const { state, client } = fakeSentry();
    const lines: string[] = [];
    const counts = await run(RULES, client, { apply: false }, (line) => lines.push(line));
    expect(counts).toEqual({ create: 1, update: 0, unchanged: 1, manual: 0 });
    expect(lines.join('\n')).toContain('workflow "New issue": would create');
    expect(state.calls.every((call) => call.startsWith('GET'))).toBe(true);
    expect(state.workflows).toHaveLength(0);
  });

  it('apply creates the workflow once and is idempotent on the second run', async () => {
    const { state, client } = fakeSentry();
    expect(await run(RULES, client, { apply: true }, () => undefined)).toEqual({
      create: 1,
      update: 0,
      unchanged: 1,
      manual: 0,
    });
    expect(state.workflows).toHaveLength(1);
    expect(state.workflows[0]).toMatchObject({ name: 'New issue', detectorIds: ['2'] });
    state.calls.length = 0;
    expect(await run(RULES, client, { apply: true }, () => undefined)).toEqual({
      create: 0,
      update: 0,
      unchanged: 2,
      manual: 0,
    });
    expect(state.calls.some((call) => call.startsWith('POST') || call.startsWith('PUT'))).toBe(false);
  });

  it('updates a workflow that drifted from the rules', async () => {
    const { state, client } = fakeSentry({
      workflows: [{ id: '7', name: 'New issue', detectorIds: ['2'], enabled: false, triggers: {} }],
    });
    const counts = await run(RULES, client, { apply: true }, () => undefined);
    expect(counts.update).toBe(1);
    expect(state.workflows[0]).toMatchObject({ enabled: true, triggers: RULES.workflows[0]?.triggers });
    expect(state.calls).toContain('PUT workflows/7/');
  });

  it('reports a monitor it may not create or change as manual work instead of failing', async () => {
    const { client } = fakeSentry({ detectors: [{ id: '2', name: 'Issue Stream', projectId: '10' }] });
    const lines: string[] = [];
    const counts = await run(RULES, client, { apply: true }, (line) => lines.push(line));
    expect(counts.manual).toBe(1);
    expect(lines.join('\n')).toContain('do it in the Sentry UI (see docs/alerting.md)');

    const disabled = fakeSentry({
      detectors: [
        { id: '1', name: 'Error Monitor', projectId: '10', enabled: false },
        { id: '2', name: 'Issue Stream', projectId: '10' },
      ],
    });
    expect((await run(RULES, disabled.client, { apply: true }, () => undefined)).manual).toBe(1);
  });

  it('plans a workflow for a detector that this run creates, and fails for one that does not exist', async () => {
    const { client } = fakeSentry({ detectors: [] });
    const rules: AlertRules = {
      ...RULES,
      detectors: [{ name: 'Issue Stream', project: 'server' }],
    };
    const lines: string[] = [];
    await run(rules, client, { apply: false }, (line) => lines.push(line));
    expect(lines).toHaveLength(2);
    await expect(run(RULES, client, { apply: false }, () => undefined)).rejects.toThrow(
      'refers to a detector "Issue Stream" that does not exist',
    );
  });

  it('fails for a project that is not in the organisation', async () => {
    const { client } = fakeSentry();
    const rules: AlertRules = { ...RULES, detectors: [], workflows: [{ ...RULES.workflows[0]!, project: 'ghost' }] };
    await expect(buildPlan(rules, client)).rejects.toThrow('Sentry project "ghost" was not found');
  });

  it('a failing workflow request is an error and surfaces the status without the token', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{"detail":"Denied"}', { status: 401 })));
    const client = createClient({ token: 'personal-token-value', organization: 'acme', fetchImpl });
    await expect(client.get('workflows/')).rejects.toThrow('GET workflows/ answered 401: {"detail":"Denied"}');
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('https://sentry.io/api/0/organizations/acme/workflows/');
    expect(new Headers(call[1].headers).get('authorization')).toBe('Bearer personal-token-value');
  });

  it('the client sends JSON bodies and accepts an empty answer', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const client = createClient({ token: 't', organization: 'acme', base: 'https://example.test/api', fetchImpl });
    expect(await client.put('workflows/1/', { a: 1 })).toBeNull();
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('https://example.test/api/organizations/acme/workflows/1/');
    expect(call[1].body).toBe('{"a":1}');
  });
});

describe('sentry-alerts main', () => {
  it('prints usage for bad arguments', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main([], realRoot, {})).toBe(2);
  });

  it('validates the file without a token: dry run succeeds, apply fails, Sentry is never contacted', async () => {
    const root = rulesFile({ organization: 'acme', detectors: [], workflows: [] });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetchImpl = vi.fn();
    expect(await main(['--dry-run'], root, {}, fetchImpl)).toBe(0);
    expect(await main(['--apply'], root, {}, fetchImpl)).toBe(1);
    expect(log.mock.calls.join('\n')).toContain('SENTRY_API_TOKEN is not set');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports an unreadable rules file', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['--dry-run', '--file=missing.json'], realRoot, {})).toBe(1);
    expect(error.mock.calls.join('\n')).toContain('[sentry-alerts]');
  });

  it('applies end to end through main with a token and summarises the plan', async () => {
    const root = rulesFile({
      organization: 'acme',
      detectors: [],
      workflows: [{ name: 'W', project: 'server', detectors: ['Issue Stream'] }],
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { client } = fakeSentry();
    const fetchImpl = vi.fn((url: string, init: RequestInit) => {
      const resource = url.replace('https://sentry.io/api/0/organizations/acme/', '');
      const method = (init.method ?? 'GET').toLowerCase() as 'get' | 'post' | 'put';
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      return (client[method] as (r: string, b?: unknown) => Promise<unknown>)(resource, body).then(
        (result) => new Response(JSON.stringify(result)),
      );
    });
    const env = { SENTRY_API_TOKEN: 'personal-token' } as NodeJS.ProcessEnv;
    expect(await main(['--apply'], root, env, fetchImpl as unknown as typeof fetch)).toBe(0);
    expect(log.mock.calls.join('\n')).toContain('1 to create, 0 to update, 0 unchanged (applied)');

    const failing = vi.fn(() => Promise.resolve(new Response('no', { status: 500 })));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['--dry-run'], root, env, failing as unknown as typeof fetch)).toBe(1);
    expect(error.mock.calls.join('\n')).toContain('answered 500');
  });
});
