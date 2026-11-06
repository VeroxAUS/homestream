import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  audit,
  createContext,
  decide,
  discoverProjects,
  levelRates,
  loadCriteria,
  main,
  runChecker,
  selectApps,
  type CriterionResult,
} from '../../../../scripts/readiness-audit.mjs';
import { makeTempDir, removeDir } from '../helpers.js';

const root = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) removeDir(dir);
});
afterEach(() => vi.restoreAllMocks());

const noGh = () => ({ status: 1, stdout: '' });

function tree(files: Record<string, string>): string {
  const dir = makeTempDir('readiness');
  roots.push(dir);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

describe('readiness-criteria.json', () => {
  const { criteria, defaultApps } = loadCriteria(root);

  it('lists the 81 criterion IDs once, with 9, 10, 30 and 32 criteria at levels 1 to 4', () => {
    expect(criteria).toHaveLength(81);
    expect(new Set(criteria.map((criterion) => criterion.id)).size).toBe(81);
    const perLevel = [1, 2, 3, 4].map((level) => criteria.filter((criterion) => criterion.level === level).length);
    expect(perLevel).toEqual([9, 10, 30, 32]);
  });

  it('gives every criterion a scope and a checker of a known type', () => {
    const known = [
      'files',
      'contains',
      'rootScripts',
      'appScripts',
      'appFiles',
      'appContains',
      'appTsconfigStrict',
      'knipWorkspace',
      'skills',
      'trackedEnv',
      'skip',
      'all',
      'git',
      'gh',
    ];
    for (const criterion of criteria) {
      expect(['repo', 'app']).toContain(criterion.scope);
      expect(known, criterion.id).toContain(criterion.checker.type);
    }
  });

  it('names the agreed pillar criteria', () => {
    const ids = criteria.map((criterion) => criterion.id);
    for (const id of [
      'branch_protection',
      'agents_md',
      'codeowners',
      'release_automation',
      'secret_scanning',
      'error_to_insight_pipeline',
    ]) {
      expect(ids).toContain(id);
    }
    expect(defaultApps).toContain('server');
  });
});

describe('checkers', () => {
  it('files, contains and rootScripts report what is missing', () => {
    const dir = tree({ 'a.txt': 'hello world', 'package.json': JSON.stringify({ scripts: { lint: 'x' } }) });
    const context = createContext(dir, { run: noGh, repo: null });
    expect(runChecker({ type: 'files', all: ['a.txt'] }, context).status).toBe('PASS');
    expect(runChecker({ type: 'files', all: ['a.txt', 'b.txt'] }, context)).toMatchObject({
      status: 'FAIL',
      evidence: 'missing b.txt',
    });
    expect(runChecker({ type: 'contains', file: 'a.txt', pattern: 'wor' }, context).status).toBe('PASS');
    expect(runChecker({ type: 'contains', file: 'a.txt', pattern: 'xyz' }, context).status).toBe('FAIL');
    expect(runChecker({ type: 'rootScripts', scripts: ['lint', 'build'] }, context).evidence).toContain('build');
  });

  it('app checkers look inside the app folder only', () => {
    const dir = tree({
      'apps/one/package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
      'apps/one/src/a.test.ts': 'import {pino} from "pino"',
      'apps/two/package.json': '{}',
    });
    const context = createContext(dir, { run: noGh, repo: null });
    const scope = { dir: 'apps/one', name: 'one' };
    expect(runChecker({ type: 'appScripts', scripts: ['test'] }, context, scope).status).toBe('PASS');
    expect(runChecker({ type: 'appFiles', pathRegex: '\\.test\\.ts$' }, context, scope).status).toBe('PASS');
    expect(runChecker({ type: 'appContains', pattern: 'pino' }, context, scope).status).toBe('PASS');
    expect(
      runChecker({ type: 'appFiles', pathRegex: '\\.test\\.ts$' }, context, { dir: 'apps/two', name: 'two' }).status,
    ).toBe('FAIL');
  });

  it('GitHub checks are skipped, not failed, when gh is unavailable', () => {
    const context = createContext(root, { run: noGh, repo: 'o/r' });
    expect(runChecker({ type: 'gh', check: 'branchProtection' }, context).status).toBe('SKIP');
  });

  it('branch protection needs required checks and blocked force pushes', () => {
    const protection = {
      required_status_checks: { contexts: ['Linux', 'Windows'] },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
    };
    const run = (command: string, args: string[]) =>
      command === 'gh' && args[0] === 'auth'
        ? { status: 0, stdout: '' }
        : { status: 0, stdout: JSON.stringify(protection) };
    expect(
      runChecker({ type: 'gh', check: 'branchProtection' }, createContext(root, { run, repo: 'o/r' })).status,
    ).toBe('PASS');
    protection.allow_force_pushes.enabled = true;
    expect(
      runChecker({ type: 'gh', check: 'branchProtection' }, createContext(root, { run, repo: 'o/r' })).status,
    ).toBe('FAIL');
  });
});

describe('levels and decision', () => {
  const result = (level: number, status: string, scope = 'repo'): CriterionResult =>
    ({ id: `c${level}${status}${scope}`, level, status, scope, apps: [], evidence: '' }) as unknown as CriterionResult;

  it('counts skipped criteria as not passed in the conservative rate and leaves them out of the evaluated rate', () => {
    const levels = levelRates([
      result(3, 'PASS'),
      result(3, 'PASS'),
      result(3, 'PASS'),
      result(3, 'FAIL'),
      result(3, 'SKIP'),
    ]);
    expect(levels[3]).toMatchObject({ total: 5, passed: 3, failed: 1, skipped: 1, conservative: 60, evaluated: 75 });
    expect(levels[4]).toMatchObject({ total: 0, conservative: 100 });
  });

  it('exits ok only when L1 to L3 reach 80% and no app criterion fails', () => {
    const good = [result(1, 'PASS'), result(2, 'PASS'), result(3, 'PASS')];
    expect(decide(good, levelRates(good)).ok).toBe(true);
    const lowL3 = [result(1, 'PASS'), result(2, 'PASS'), result(3, 'PASS'), result(3, 'FAIL')];
    expect(decide(lowL3, levelRates(lowL3)).ok).toBe(false);
    const appFail = [result(1, 'PASS'), result(2, 'PASS'), result(3, 'PASS'), result(4, 'FAIL', 'app')];
    appFail[3] = { ...appFail[3], apps: [{ app: 'web', status: 'FAIL', evidence: '' }] } as CriterionResult;
    expect(decide(appFail, levelRates(appFail))).toMatchObject({ ok: false });
  });

  it('--strict demands L3 >= 90% and L4 >= 78%', () => {
    const results = [
      result(1, 'PASS'),
      result(2, 'PASS'),
      ...Array.from({ length: 4 }, () => result(3, 'PASS')),
      result(3, 'FAIL'),
      result(4, 'PASS'),
    ];
    const levels = levelRates(results);
    expect(decide(results, levels).ok).toBe(true);
    expect(decide(results, levels, { strict: true }).ok).toBe(false);
  });
});

describe('selectApps and the report', () => {
  const projects = { apps: ['server', 'web'], libraries: ['shared'] };

  it('uses the default apps, --all or --apps', () => {
    expect(selectApps(projects, [], { defaultApps: ['server'] }).apps).toEqual(['server']);
    expect(selectApps(projects, ['--all'], { defaultApps: ['server'] }).apps).toEqual(['server', 'web']);
    expect(selectApps(projects, ['--apps', 'web,tv'], { defaultApps: ['server'] }).apps).toEqual(['web']);
  });

  it('finds the real apps and libraries of this repository', () => {
    expect(discoverProjects(root).apps).toEqual(expect.arrayContaining(['server', 'web']));
    expect(discoverProjects(root).libraries).toContain('shared');
  });

  it('prints one line per criterion, valid JSON with --json, and no gh call needed', () => {
    const report = audit(root, [], { run: noGh, repo: null });
    expect(report.results).toHaveLength(81);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    main(['--json'], root, { run: noGh, repo: null });
    const parsed = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(parsed.criteria).toHaveLength(81);
    expect(parsed.levels['1']).toBeDefined();
    log.mockClear();
    main([], root, { run: noGh, repo: null });
    const text = String(log.mock.calls[0]?.[0]);
    expect(text.split('\n').filter((line) => /^(PASS|FAIL|SKIP)\s+L\d/.test(line))).toHaveLength(81);
    expect(text).toContain('Level  pass/total');
  });
});
