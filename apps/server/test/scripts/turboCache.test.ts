import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from '../helpers.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const turboBin = path.join(repoRoot, 'node_modules', 'turbo', 'bin', 'turbo');
const TASKS = ['typecheck', 'lint', 'test:ci'] as const;
const ALL = ['@homestream/shared', '@homestream/server', '@homestream/web'];
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) removeDir(dir);
});

/** The real turbo.json and package graph with every task script replaced by a no-op, so only the cache keys are exercised. */
function throwawayWorkspace(): string {
  const dir = makeTempDir('turbo-cache');
  dirs.push(dir);
  for (const file of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'turbo.json', 'tsconfig.base.json']) {
    cpSync(path.join(repoRoot, file), path.join(dir, file));
  }
  for (const file of ['eslint.config.mjs', 'vitest.shared.ts']) writeFileSync(path.join(dir, file), '// stub\n');
  writeFileSync(path.join(dir, '.gitignore'), '.turbo/\nnode_modules/\n');
  for (const pkg of ['apps/server', 'apps/web', 'packages/shared']) {
    mkdirSync(path.join(dir, pkg, 'src'), { recursive: true });
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, pkg, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const task of TASKS) if (manifest.scripts[task]) manifest.scripts[task] = 'node -e 0';
    writeFileSync(path.join(dir, pkg, 'package.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(path.join(dir, pkg, 'src', 'index.ts'), 'export const value = 1;\n');
  }
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore', windowsHide: true });
  return dir;
}

/** Runs the tasks and reports which were replayed from the cache and which ran. */
function lastRun(dir: string): { cached: Set<string>; executed: Set<string> } {
  const env = { ...process.env, TURBO_TELEMETRY_DISABLED: '1', TURBO_UI: 'false', CI: '' };
  const result = spawnSync(
    process.execPath,
    [turboBin, 'run', ...TASKS, '--cache-dir=.turbo/cache', '--output-logs=hash-only'],
    { cwd: dir, env, encoding: 'utf8', windowsHide: true },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const cached = new Set<string>();
  const executed = new Set<string>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /(@homestream\/[a-z]+:[a-z:]+): (cache hit|cache miss)/.exec(line);
    if (match) (match[2] === 'cache hit' ? cached : executed).add(match[1] ?? '');
  }
  return { cached, executed };
}

const everyTask = (packages: string[]) => packages.flatMap((pkg) => TASKS.map((task) => `${pkg}:${task}`));

describe('turbo cache keys', () => {
  // The first turbo run in a fresh directory starts pnpm cold, which takes several seconds.
  const TIMEOUT_MS = 120_000;

  it(
    'invalidates the consumers of packages/shared when only a shared source file changes',
    () => {
      const dir = throwawayWorkspace();
      const cold = lastRun(dir);
      expect(cold.cached.size).toBe(0);
      expect(cold.executed.size).toBe(everyTask(ALL).length);

      const warm = lastRun(dir);
      expect(warm.executed.size).toBe(0);
      expect(warm.cached.size).toBe(everyTask(ALL).length);

      writeFileSync(path.join(dir, 'packages/shared/src/index.ts'), 'export const value = 2;\n');
      const afterShared = lastRun(dir);
      expect([...afterShared.executed].sort()).toEqual(everyTask(ALL).sort());
      expect(afterShared.cached.size).toBe(0);
    },
    TIMEOUT_MS,
  );

  it(
    'keeps the other packages cached when only one app changes',
    () => {
      const dir = throwawayWorkspace();
      lastRun(dir);
      writeFileSync(path.join(dir, 'apps/server/src/index.ts'), 'export const value = 3;\n');
      const result = lastRun(dir);
      expect([...result.executed].sort()).toEqual(everyTask(['@homestream/server']).sort());
      expect([...result.cached].sort()).toEqual(everyTask(['@homestream/shared', '@homestream/web']).sort());
    },
    TIMEOUT_MS,
  );
});
