import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveEnv } from './lib/dotenv.mjs';
import { isMain, repoRoot } from './lib/util.mjs';

/**
 * Feature-flag tooling around the registry in packages/shared/src/flags.ts.
 *   check  flags nothing reads (dead) and flags the code evaluates that the registry does not declare (unknown)
 *   sync   creates registry flags that PostHog does not have yet; never changes an existing flag (idempotent)
 * `pnpm flags:check`, `pnpm flags:sync [--dry-run]`.
 */

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.kt', '.mjs']);
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'reports', 'test', 'tests', '.turbo']);
const REGISTRY_FILE = path.join('packages', 'shared', 'src', 'flags.ts');
const EVALUATION_CALL = /\b(?:flag|getFlag|isFlagEnabled|useFlag)\(\s*['"]([a-z0-9][a-z0-9-]*)['"]/g;
const POSTHOG_APP_HOST = (ingestionHost) => ingestionHost.replace('.i.posthog.com', '.posthog.com').replace(/\/+$/, '');
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

export async function loadRegistry(root) {
  const module = await import(pathToFileURL(path.join(root, REGISTRY_FILE)).href);
  return module.FLAGS;
}

function* sourceFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* sourceFiles(full);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

function sourceRoots(root) {
  const roots = [];
  for (const group of ['apps', 'packages']) {
    const dir = path.join(root, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) roots.push(path.join(dir, name));
  }
  return roots;
}

/** Which registry keys appear in application code, and which keys the code evaluates. Tests and the registry itself do not count. */
export function scanUsage(root, keys) {
  const referenced = new Set();
  const evaluated = new Map();
  const registryFile = path.join(root, REGISTRY_FILE);
  for (const appRoot of sourceRoots(root)) {
    for (const file of sourceFiles(appRoot)) {
      if (file === registryFile) continue;
      const text = readFileSync(file, 'utf8');
      for (const key of keys) if (text.includes(`'${key}'`) || text.includes(`"${key}"`)) referenced.add(key);
      for (const match of text.matchAll(EVALUATION_CALL)) {
        const key = match[1];
        if (!evaluated.has(key)) evaluated.set(key, path.relative(root, file).replace(/\\/g, '/'));
      }
    }
  }
  return { referenced, evaluated };
}

export function checkFlags(registry, usage) {
  const keys = Object.keys(registry);
  const dead = keys.filter((key) => registry[key].status === 'active' && !usage.referenced.has(key));
  const planned = keys.filter((key) => registry[key].status === 'planned' && !usage.referenced.has(key));
  const unknown = [...usage.evaluated].filter(([key]) => !keys.includes(key)).map(([key, file]) => ({ key, file }));
  return { dead, planned, unknown };
}

export function flagBody(key, definition) {
  const groups = [{ properties: [], rollout_percentage: 100 }];
  const filters =
    definition.type === 'boolean'
      ? { groups }
      : {
          groups,
          multivariate: {
            variants: definition.variants.map((variant, index, all) => ({
              key: variant,
              name: variant,
              rollout_percentage:
                index === all.length - 1
                  ? 100 - Math.floor(100 / all.length) * (all.length - 1)
                  : Math.floor(100 / all.length),
            })),
          },
        };
  // A planned flag is created switched off so that declaring it never changes what anyone sees.
  return { key, name: definition.description, filters, active: definition.status === 'active', tags: ['homestream'] };
}

async function listExistingKeys(request, base) {
  const keys = new Set();
  let url = `${base}/api/projects/@current/feature_flags/?limit=200`;
  while (url) {
    const response = await request(url);
    if (!response.ok) throw new Error(`PostHog answered ${response.status} when listing flags.`);
    const page = await response.json();
    for (const flag of page.results ?? []) keys.add(flag.key);
    url = page.next ?? null;
  }
  return keys;
}

/** Creates the missing flags. Returns what was created and what already existed. */
export async function syncFlags(registry, { personalKey, host, fetchImpl = fetch, dryRun = false }) {
  const base = POSTHOG_APP_HOST(host || DEFAULT_POSTHOG_HOST);
  const authorized = (url, init = {}) =>
    fetchImpl(url, {
      ...init,
      headers: { authorization: `Bearer ${personalKey}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  const existing = await listExistingKeys(authorized, base);
  const created = [];
  const present = [];
  for (const [key, definition] of Object.entries(registry)) {
    if (existing.has(key)) {
      present.push(key);
      continue;
    }
    if (!dryRun) {
      const response = await authorized(`${base}/api/projects/@current/feature_flags/`, {
        method: 'POST',
        body: JSON.stringify(flagBody(key, definition)),
      });
      if (!response.ok) throw new Error(`PostHog answered ${response.status} when creating flag ${key}.`);
    }
    created.push(key);
  }
  return { created, present };
}

async function runCheck(root) {
  const registry = await loadRegistry(root);
  const result = checkFlags(registry, scanUsage(root, Object.keys(registry)));
  for (const key of result.planned) console.log(`[flags] ${key}: planned, no app reads it yet`);
  for (const key of result.dead) console.error(`[flags] ${key}: dead flag, declared as active but nothing reads it`);
  for (const { key, file } of result.unknown) {
    console.error(
      `[flags] ${key}: unknown flag evaluated in ${file}; declare it in ${REGISTRY_FILE.replace(/\\/g, '/')}`,
    );
  }
  if (result.dead.length > 0 || result.unknown.length > 0) return 1;
  console.log(`[flags] ok (${Object.keys(registry).length} flags)`);
  return 0;
}

async function runSync(root, argv, env) {
  const registry = await loadRegistry(root);
  const resolved = resolveEnv(root, env);
  const personalKey = resolved.POSTHOG_PERSONAL_API_KEY;
  if (!personalKey) {
    console.log(
      '[flags] POSTHOG_PERSONAL_API_KEY is not set; skipping the PostHog sync. Flags keep their local defaults.',
    );
    return 0;
  }
  const dryRun = argv.includes('--dry-run');
  try {
    const { created, present } = await syncFlags(registry, { personalKey, host: resolved.POSTHOG_HOST, dryRun });
    for (const key of created) console.log(`[flags] ${dryRun ? 'would create' : 'created'} ${key}`);
    for (const key of present) console.log(`[flags] ${key}: already in PostHog`);
    return 0;
  } catch (error) {
    console.error(`[flags] sync failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    return 1;
  }
}

export async function main(argv, root = repoRoot(), env = process.env) {
  const [command, ...rest] = argv;
  if (command === 'check') return runCheck(root);
  if (command === 'sync') return runSync(root, rest, env);
  console.error('Usage: node scripts/flags.mjs <check|sync [--dry-run]>');
  return 2;
}

if (isMain(import.meta.url)) process.exit(await main(process.argv.slice(2)));
