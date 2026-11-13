import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Turbo runs tasks in strict env mode and keys its cache on the declared variables only. A build-time variable that
// turbo.json does not list never reaches `pnpm build` and cannot change the cache key, so a cached build made with
// telemetry on would be restored for a build made with it off.

// jsdom replaces import.meta.url, so the paths come from the working directory (vitest runs in apps/web).
const webRoot = process.cwd();
const repoRoot = resolve(webRoot, '../..');

function readText(root: string, file: string): string {
  return readFileSync(resolve(root, file), 'utf8');
}

function readJson(root: string, file: string): unknown {
  return JSON.parse(readText(root, file));
}

/** The variables the Vite build reads: `env.NAME` in the config files and the build-time telemetry helper. */
function buildVariables(): string[] {
  const sources = ['vite.config.ts', 'vite.plugins.ts', 'src/telemetry/buildEnv.ts'];
  const names = new Set<string>();
  for (const file of sources) {
    for (const match of readText(webRoot, file).matchAll(/\benv\.([A-Z][A-Z0-9_]+)\b/g)) names.add(match[1] ?? '');
  }
  return [...names].sort();
}

function turboBuildEnv(): string[] {
  const turbo = readJson(repoRoot, 'turbo.json') as { tasks: { build: { env?: string[] } } };
  return turbo.tasks.build.env ?? [];
}

describe('turbo.json build task', () => {
  it('finds the variables the web build reads', () => {
    expect(buildVariables()).toEqual(expect.arrayContaining(['HOMESTREAM_TELEMETRY', 'POSTHOG_API_KEY']));
  });

  it('declares every variable the web build reads', () => {
    const declared = new Set(turboBuildEnv());
    const missing = buildVariables().filter((name) => !declared.has(name));
    expect(missing).toEqual([]);
  });

  it('declares no variable the web build does not read', () => {
    const read = new Set(buildVariables());
    expect(turboBuildEnv().filter((name) => !read.has(name))).toEqual([]);
  });

  // Turbo restores cached outputs on top of dist without emptying it, and the Vite config also reads `.env`, which the
  // cache key does not cover. A restored build would leave the files (and keys) of an earlier build next to its own.
  it('never restores a cached web dist', () => {
    const web = readJson(webRoot, 'turbo.json') as { tasks: { build: { cache?: boolean } } };
    expect(web.tasks.build.cache).toBe(false);
  });
});
