import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FLAGS } from '@homestream/shared';
import {
  checkFlags,
  flagBody,
  loadRegistry,
  main,
  scanUsage,
  syncFlags,
  type FlagRegistryLike,
} from '../../../../scripts/flags.mjs';
import { makeTempDir, removeDir } from '../helpers.js';

const realRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const dirs: string[] = [];

const REGISTRY: FlagRegistryLike = {
  alpha: { type: 'boolean', default: true, description: 'Alpha', status: 'active' },
  beta: { type: 'multivariate', variants: ['a', 'b', 'c'], default: 'a', description: 'Beta', status: 'planned' },
};

function tempRoot(files: Record<string, string>): string {
  const root = makeTempDir('flags');
  dirs.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  for (const dir of dirs) removeDir(dir);
});

describe('flags:check', () => {
  it('loads the real registry and finds no dead or unknown flag in the repository', async () => {
    const registry = await loadRegistry(realRoot);
    expect(Object.keys(registry)).toEqual(Object.keys(FLAGS));
    const result = checkFlags(registry, scanUsage(realRoot, Object.keys(registry)));
    expect(result.dead).toEqual([]);
    expect(result.unknown).toEqual([]);
    expect(result.planned).toEqual(['banner-rotation-interval']);
  });

  it('reports an active flag that nothing reads and a flag that is evaluated but not declared', () => {
    const root = tempRoot({
      'apps/server/src/a.ts': "await telemetry.flag('alpha-typo');\nconst x = 'beta';",
      'apps/server/test/ignored.test.ts': "telemetry.flag('only-in-tests')",
      'packages/shared/src/flags.ts': "export const FLAGS = { alpha: 'alpha' }",
    });
    const usage = scanUsage(root, Object.keys(REGISTRY));
    expect([...usage.referenced]).toEqual(['beta']);
    expect([...usage.evaluated.keys()]).toEqual(['alpha-typo']);
    expect(checkFlags(REGISTRY, usage)).toEqual({
      dead: ['alpha'],
      planned: [],
      unknown: [{ key: 'alpha-typo', file: 'apps/server/src/a.ts' }],
    });
  });

  it('exits non-zero for dead or unknown flags and zero when the registry is clean', async () => {
    const registryModule = `export const FLAGS = { alpha: { type: 'boolean', default: true, description: 'A', status: 'active' } };`;
    const dirty = tempRoot({
      'packages/shared/src/flags.ts': registryModule,
      'apps/server/src/a.ts': "telemetry.flag('ghost')",
    });
    const clean = tempRoot({
      'packages/shared/src/flags.ts': registryModule,
      'apps/server/src/a.ts': "telemetry.flag('alpha')",
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await main(['check'], dirty)).toBe(1);
    const reported = error.mock.calls.map((call) => String(call[0])).join('\n');
    expect(reported).toContain('alpha: dead flag');
    expect(reported).toContain('ghost: unknown flag');
    expect(await main(['check'], clean)).toBe(0);
    expect(log.mock.calls.map((call) => String(call[0])).join('\n')).toContain('ok (1 flags)');
  });

  it('prints usage for an unknown command', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['nope'], realRoot)).toBe(2);
  });
});

describe('flags:sync', () => {
  it('builds a boolean body switched on and a multivariate body whose rollout adds up to 100', () => {
    expect(flagBody('alpha', REGISTRY.alpha!)).toMatchObject({
      key: 'alpha',
      active: true,
      filters: { groups: [{ rollout_percentage: 100 }] },
    });
    const planned = flagBody('beta', REGISTRY.beta!) as {
      active: boolean;
      filters: { multivariate: { variants: { key: string; rollout_percentage: number }[] } };
    };
    expect(planned.active).toBe(false);
    const variants = planned.filters.multivariate.variants;
    expect(variants.map((variant) => variant.key)).toEqual(['a', 'b', 'c']);
    expect(variants.reduce((sum, variant) => sum + variant.rollout_percentage, 0)).toBe(100);
  });

  it('creates only the missing flags and creates nothing on a second run', async () => {
    const existing = new Set<string>(['alpha']);
    const created: string[] = [];
    const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer personal-key');
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { key: string };
        created.push(body.key);
        existing.add(body.key);
        return Promise.resolve(jsonResponse({}, 201));
      }
      return Promise.resolve(jsonResponse({ results: [...existing].map((key) => ({ key })), next: null }));
    });
    const options = { personalKey: 'personal-key', host: 'https://eu.i.posthog.com', fetchImpl };
    expect(await syncFlags(REGISTRY, options)).toEqual({ created: ['beta'], present: ['alpha'] });
    expect(created).toEqual(['beta']);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://eu.posthog.com/api/projects/@current/feature_flags/?limit=200',
    );
    expect(await syncFlags(REGISTRY, options)).toEqual({ created: [], present: ['alpha', 'beta'] });
    expect(created).toEqual(['beta']);
  });

  it('follows pagination and creates nothing in a dry run', async () => {
    const pages = [
      jsonResponse({ results: [{ key: 'alpha' }], next: 'https://us.posthog.com/next-page' }),
      jsonResponse({ results: [], next: null }),
    ];
    const fetchImpl = vi.fn(() => Promise.resolve(pages.shift() as Response));
    const result = await syncFlags(REGISTRY, { personalKey: 'k', host: '', fetchImpl, dryRun: true });
    expect(result).toEqual({ created: ['beta'], present: ['alpha'] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails with the status code when PostHog refuses, without printing the key', async () => {
    const refuse = vi.fn(() => Promise.resolve(jsonResponse({}, 401)));
    await expect(syncFlags(REGISTRY, { personalKey: 'secret-value', host: '', fetchImpl: refuse })).rejects.toThrow(
      'PostHog answered 401 when listing flags.',
    );
    const failCreate = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockResolvedValueOnce(jsonResponse({}, 400));
    await expect(syncFlags(REGISTRY, { personalKey: 'k', host: '', fetchImpl: failCreate })).rejects.toThrow(
      'when creating flag alpha',
    );
  });

  it('skips with a message when no personal key is set', async () => {
    const root = tempRoot({ 'packages/shared/src/flags.ts': 'export const FLAGS = {};' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await main(['sync'], root, {})).toBe(0);
    expect(log.mock.calls.map((call) => String(call[0])).join('\n')).toContain('POSTHOG_PERSONAL_API_KEY is not set');
  });

  it('syncs through main with a key from the environment and reports a failing sync', async () => {
    const root = tempRoot({
      'packages/shared/src/flags.ts': `export const FLAGS = { alpha: { type: 'boolean', default: true, description: 'A', status: 'active' } };`,
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [{ key: 'alpha' }] }))
      .mockResolvedValueOnce(jsonResponse({}, 500));
    const env = { POSTHOG_PERSONAL_API_KEY: 'k', POSTHOG_HOST: 'https://us.i.posthog.com' } as NodeJS.ProcessEnv;
    expect(await main(['sync', '--dry-run'], root, env)).toBe(0);
    expect(log.mock.calls.map((call) => String(call[0])).join('\n')).toContain('alpha: already in PostHog');
    expect(await main(['sync'], root, env)).toBe(1);
    expect(error.mock.calls.map((call) => String(call[0])).join('\n')).toContain('sync failed');
    expect(stub).toHaveBeenCalledTimes(2);
  });
});
