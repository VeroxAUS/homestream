import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isMain, repoRoot } from './lib/util.mjs';

/**
 * Self-audit against the Factory Agent Readiness criteria: one line per criterion (PASS, FAIL or SKIP with the
 * evidence), per-app results, and the pass rate of the inferred levels L1 to L4. Criteria and checkers are data in
 * scripts/readiness-criteria.json. GitHub settings are read with an authenticated `gh`; without it those criteria are
 * skipped. Secret values are never read or printed.
 *   pnpm readiness:audit [--apps server,web] [--all] [--strict] [--json]
 * Default apps are the ones listed as "defaultApps" in the criteria file (the apps that have finished their readiness
 * work), --all evaluates every app folder, --apps picks some. Exit 0 only when L1, L2 and L3 are each >= 80% and no
 * app-scoped criterion fails for an evaluated app. --strict also demands L1 = 100%, L2 = 100%, L3 >= 90%, L4 >= 78%
 * and treats skipped GitHub checks as failures.
 */

export const LEVEL_MINIMUMS = { 1: 80, 2: 80, 3: 80 };
export const STRICT_MINIMUMS = { 1: 100, 2: 100, 3: 90, 4: 78 };
const WALK_SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo', '.gradle', 'reports', '.git']);
const STALE_DOCS_DAYS = 180;
const CI_BUDGET_SECONDS = 600;
const COMMIT_WINDOW = 10;
const COAUTHOR_TRAILER =
  /^Co-authored-by: factory-droid\[bot\] <138933559\+factory-droid\[bot\]@users\.noreply\.github\.com>$/m;
const BOT_AUTHORS = /dependabot|github-actions/i;
const DEFAULT_CODE_FILES = '(^|/)(src|app/src)/.*\\.(ts|tsx|kt|mjs)$|(^|/)package\\.json$';

const pass = (evidence) => ({ status: 'PASS', evidence });
const fail = (evidence) => ({ status: 'FAIL', evidence });
const skip = (evidence) => ({ status: 'SKIP', evidence });
const verdict = (ok, good, bad) => (ok ? pass(good) : fail(bad));

export function loadCriteria(root) {
  const file = path.join(root, 'scripts', 'readiness-criteria.json');
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** App folders (`apps/*`) and libraries (`packages/*`) with a manifest or Gradle build. */
export function discoverProjects(root) {
  const find = (group) => {
    const dir = path.join(root, group);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => {
        const full = path.join(dir, entry.name);
        return ['package.json', 'build.gradle', 'build.gradle.kts', 'settings.gradle.kts'].some((name) =>
          existsSync(path.join(full, name)),
        );
      })
      .map((entry) => entry.name);
  };
  return { apps: find('apps'), libraries: find('packages') };
}

function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (WALK_SKIP.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).replaceAll('\\', '/')];
  });
}

const readText = (root, file) =>
  existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), 'utf8') : null;
const readJson = (root, file) => {
  const text = readText(root, file);
  return text === null ? null : JSON.parse(text);
};

/** Wraps the process runners so tests can replace them. */
export function createContext(root, overrides = {}) {
  const run = (command, args) => {
    try {
      const stdout = execFileSync(command, args, {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      });
      return { status: 0, stdout };
    } catch (error) {
      return { status: typeof error.status === 'number' ? error.status : 1, stdout: String(error.stdout ?? '') };
    }
  };
  const context = { root, run: overrides.run ?? run, repo: overrides.repo ?? null, ghReady: null, files: new Map() };
  context.repo ??= resolveRepo(context);
  return context;
}

function resolveRepo(context) {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const remote = context.run('git', ['remote', 'get-url', 'origin']).stdout.trim();
  return /github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(remote)?.[1] ?? null;
}

const ghReady = (context) => {
  context.ghReady ??= context.run('gh', ['auth', 'status']).status === 0;
  return context.ghReady;
};

function ghJson(context, args) {
  const result = context.run('gh', args);
  if (result.status !== 0) return { error: `gh ${args[0]} failed` };
  try {
    return { value: JSON.parse(result.stdout || 'null') };
  } catch {
    return { error: `gh ${args[0]} returned invalid JSON` };
  }
}

const projectFiles = (context, appDir) => {
  const key = appDir;
  if (!context.files.has(key)) {
    const full = path.join(context.root, appDir);
    context.files.set(key, existsSync(full) ? listFiles(full) : []);
  }
  return context.files.get(key);
};

// --- checkers: (checker, context, scope) -> {status, evidence}. `scope.dir` is the app folder for app criteria. ---

const CHECKERS = {
  files(checker, context) {
    const missing = (checker.all ?? []).filter((file) => !existsSync(path.join(context.root, file)));
    if (checker.all && missing.length > 0) return fail(`missing ${missing.join(', ')}`);
    if (checker.any) {
      const found = checker.any.find((file) => existsSync(path.join(context.root, file)));
      return found ? pass(found) : fail(`none of ${checker.any.join(', ')}`);
    }
    return pass((checker.all ?? []).join(', '));
  },

  contains(checker, context) {
    const text = readText(context.root, checker.file);
    if (text === null) return fail(`${checker.file} is missing`);
    const found = new RegExp(checker.pattern, `m${checker.flags ?? ''}`).test(text);
    return verdict(
      found,
      `${checker.file} matches /${checker.pattern}/`,
      `${checker.file} does not match /${checker.pattern}/`,
    );
  },

  rootScripts(checker, context) {
    const scripts = readJson(context.root, 'package.json')?.scripts ?? {};
    const missing = checker.scripts.filter((name) => !(name in scripts));
    return verdict(
      missing.length === 0,
      `package.json scripts ${checker.scripts.join(', ')}`,
      `package.json lacks script ${missing.join(', ')}`,
    );
  },

  appScripts(checker, context, scope) {
    const scripts = readJson(context.root, `${scope.dir}/package.json`)?.scripts ?? {};
    const missing = checker.scripts.filter((name) => !(name in scripts));
    return verdict(
      missing.length === 0,
      `${scope.dir}/package.json scripts ${checker.scripts.join(', ')}`,
      `${scope.dir} lacks script ${missing.join(', ')}`,
    );
  },

  appFiles(checker, context, scope) {
    const regex = new RegExp(checker.pathRegex);
    const found = projectFiles(context, scope.dir).find((file) => regex.test(file));
    return verdict(Boolean(found), `${scope.dir}/${found}`, `no file in ${scope.dir} matches /${checker.pathRegex}/`);
  },

  appContains(checker, context, scope) {
    const pathRegex = new RegExp(checker.pathRegex ?? DEFAULT_CODE_FILES);
    const pattern = new RegExp(checker.pattern, checker.flags ?? '');
    const hit = projectFiles(context, scope.dir)
      .filter((file) => pathRegex.test(file))
      .find((file) => pattern.test(readText(context.root, `${scope.dir}/${file}`) ?? ''));
    return verdict(Boolean(hit), `${scope.dir}/${hit}`, `nothing in ${scope.dir} matches /${checker.pattern}/`);
  },

  appTsconfigStrict(_checker, context, scope) {
    const tsconfig = readText(context.root, `${scope.dir}/tsconfig.json`);
    if (tsconfig === null) return fail(`${scope.dir}/tsconfig.json is missing`);
    const base = readText(context.root, 'tsconfig.base.json') ?? '';
    const strict = /tsconfig\.base\.json/.test(tsconfig) && /"strict":\s*true/.test(base);
    return verdict(
      strict,
      `${scope.dir}/tsconfig.json extends the strict base`,
      `${scope.dir}/tsconfig.json does not extend the strict tsconfig.base.json`,
    );
  },

  knipWorkspace(_checker, context, scope) {
    const knip = readText(context.root, 'knip.jsonc') ?? '';
    return verdict(
      knip.includes(`"${scope.dir}"`),
      `knip.jsonc workspace ${scope.dir}`,
      `knip.jsonc has no workspace ${scope.dir}`,
    );
  },

  skills(_checker, context) {
    const dir = path.join(context.root, '.factory', 'skills');
    const skills = existsSync(dir)
      ? readdirSync(dir).filter((name) =>
          /^name:/m.test(readText(context.root, `.factory/skills/${name}/SKILL.md`) ?? ''),
        )
      : [];
    return verdict(
      skills.length > 0,
      `${skills.length} skills in .factory/skills`,
      'no SKILL.md with a name in .factory/skills',
    );
  },

  trackedEnv(_checker, context) {
    const tracked = context
      .run('git', ['ls-files'])
      .stdout.split('\n')
      .filter((file) => /(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.env.example'));
    return verdict(tracked.length === 0, 'no tracked .env file', `tracked: ${tracked.join(', ')}`);
  },

  skip: (checker) => skip(checker.reason),

  all(checker, context, scope) {
    const results = checker.checks.map((inner) => runChecker(inner, context, scope));
    const failed = results.find((result) => result.status === 'FAIL');
    if (failed) return failed;
    const skipped = results.find((result) => result.status === 'SKIP');
    if (skipped) return skipped;
    return pass(results.map((result) => result.evidence).join('; '));
  },
};

const gitChecks = {
  coauthor(context) {
    const log = context
      .run('git', ['log', '-n', '40', '--format=%an%x1f%B%x1e'])
      .stdout.split('\x1e')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const recent = log
      .map((entry) => entry.split('\x1f'))
      .filter(([author]) => !BOT_AUTHORS.test(author ?? ''))
      .slice(0, COMMIT_WINDOW);
    const missing = recent.filter(([, message]) => !COAUTHOR_TRAILER.test(message ?? ''));
    return verdict(
      recent.length > 0 && missing.length === 0,
      `last ${recent.length} commits carry the factory-droid trailer`,
      `${missing.length} of the last ${recent.length} commits lack the Co-authored-by trailer`,
    );
  },
  docsFresh(context) {
    const ages = ['AGENTS.md', 'README.md'].map((file) => {
      const seconds = Number(context.run('git', ['log', '-1', '--format=%ct', '--', file]).stdout.trim());
      return seconds ? (Date.now() / 1000 - seconds) / 86_400 : Infinity;
    });
    return verdict(
      ages.every((days) => days <= STALE_DOCS_DAYS),
      `AGENTS.md and README.md changed within ${STALE_DOCS_DAYS} days`,
      `AGENTS.md or README.md not changed in ${STALE_DOCS_DAYS} days`,
    );
  },
};

CHECKERS.git = (checker, context) => gitChecks[checker.check](context);

const NO_GH = skip('gh is not authenticated or the GitHub remote is unknown');

const ghChecks = {
  auth: (context) => verdict(ghReady(context), 'gh auth status succeeds', 'gh auth status fails'),

  releases(context) {
    const { value, error } = ghJson(context, [
      'release',
      'list',
      '--limit',
      '5',
      '--json',
      'tagName',
      '--repo',
      context.repo,
    ]);
    if (error) return fail(error);
    return verdict(value.length > 0, `${value.length} release(s), latest ${value[0]?.tagName}`, 'no GitHub release');
  },

  ciDuration(context) {
    const { value, error } = ghJson(context, [
      'run',
      'list',
      '--workflow',
      'ci.yml',
      '--branch',
      'main',
      '--status',
      'success',
      '--limit',
      '1',
      '--json',
      'createdAt,updatedAt',
      '--repo',
      context.repo,
    ]);
    if (error) return fail(error);
    if (value.length === 0) return fail('no successful CI run on main');
    const seconds = Math.round((Date.parse(value[0].updatedAt) - Date.parse(value[0].createdAt)) / 1000);
    return verdict(
      seconds < CI_BUDGET_SECONDS,
      `latest green CI run took ${seconds}s`,
      `latest green CI run took ${seconds}s (budget ${CI_BUDGET_SECONDS}s)`,
    );
  },

  branchProtection(context) {
    const { value, error } = ghJson(context, ['api', `repos/${context.repo}/branches/main/protection`]);
    if (error) return fail('main has no branch protection');
    const checks = value.required_status_checks?.contexts?.length ?? value.required_status_checks?.checks?.length ?? 0;
    const safe = value.allow_force_pushes?.enabled === false && value.allow_deletions?.enabled === false;
    return verdict(
      checks > 0 && safe,
      `required checks: ${checks}, force pushes and deletions blocked`,
      'protection lacks required checks or allows force pushes/deletions',
    );
  },

  secretScanning(context) {
    const { value, error } = ghJson(context, ['api', `repos/${context.repo}`]);
    if (error) return fail(error);
    const enabled = value?.security_and_analysis?.secret_scanning?.status === 'enabled';
    return verdict(enabled, 'GitHub secret scanning enabled', 'GitHub secret scanning is not enabled');
  },

  backlog(context) {
    const { value, error } = ghJson(context, [
      'issue',
      'list',
      '--state',
      'open',
      '--limit',
      '30',
      '--json',
      'title,labels',
      '--repo',
      context.repo,
    ]);
    if (error) return fail(error);
    const labelled = value.filter(
      (issue) =>
        issue.title.length > 10 &&
        issue.labels.some((label) => label.name.startsWith('type:')) &&
        issue.labels.some((label) => label.name.startsWith('area:')),
    );
    return verdict(
      value.length >= 8 && labelled.length === value.length,
      `${value.length} open issues, all titled and labelled`,
      `${value.length} open issues, ${value.length - labelled.length} without a long title or type:/area: labels`,
    );
  },
};

CHECKERS.gh = (checker, context) => {
  if (!context.repo || !ghReady(context)) return NO_GH;
  return ghChecks[checker.check](context);
};

export function runChecker(checker, context, scope = {}) {
  const handler = CHECKERS[checker.type];
  if (!handler) return fail(`unknown checker type ${checker.type}`);
  try {
    return handler(checker, context, scope);
  } catch (error) {
    return fail(`checker error: ${error.message}`);
  }
}

// --- evaluation ---

function appResult(criterion, name, kind, context) {
  const dir = `${kind === 'library' ? 'packages' : 'apps'}/${name}`;
  if (criterion.appliesTo && !criterion.appliesTo.includes(name)) return { app: name, ...skip('not applicable') };
  const hasManifest = existsSync(path.join(context.root, dir, 'package.json'));
  const checker = !hasManifest && criterion.tv ? criterion.tv : criterion.checker;
  return { app: name, ...runChecker(checker, context, { dir, name }) };
}

export function evaluateCriterion(criterion, context, projects) {
  if (criterion.scope === 'repo') return { ...runChecker(criterion.checker, context), apps: [] };
  const targets = [
    ...projects.apps.map((name) => ['app', name]),
    ...(criterion.library ? projects.libraries.map((name) => ['library', name]) : []),
  ];
  const apps = targets.map(([kind, name]) => appResult(criterion, name, kind, context));
  const applicable = apps.filter((result) => result.status !== 'SKIP');
  const failed = applicable.filter((result) => result.status === 'FAIL');
  const evidence = apps
    .map(
      (result) =>
        `${result.app}: ${result.status === 'PASS' ? 'ok' : result.status === 'SKIP' ? 'n/a' : result.evidence}`,
    )
    .join('; ');
  if (applicable.length === 0) {
    const reason =
      apps.find((result) => result.evidence !== 'not applicable')?.evidence ?? 'not applicable to the evaluated apps';
    return { status: 'SKIP', evidence: reason, apps };
  }
  return { status: failed.length > 0 ? 'FAIL' : 'PASS', evidence, apps };
}

/** Pass rates per level. `conservative` counts skipped criteria as not passed; `evaluated` leaves them out. */
export function levelRates(results) {
  const levels = {};
  for (const level of [1, 2, 3, 4]) {
    const items = results.filter((result) => result.level === level);
    const passed = items.filter((result) => result.status === 'PASS').length;
    const failed = items.filter((result) => result.status === 'FAIL').length;
    const skipped = items.length - passed - failed;
    levels[level] = {
      total: items.length,
      passed,
      failed,
      skipped,
      conservative: items.length ? (passed / items.length) * 100 : 100,
      evaluated: passed + failed ? (passed / (passed + failed)) * 100 : 100,
    };
  }
  return levels;
}

export function decide(results, levels, { strict = false } = {}) {
  const reasons = [];
  const minimums = strict ? STRICT_MINIMUMS : LEVEL_MINIMUMS;
  for (const [level, minimum] of Object.entries(minimums)) {
    const rate = levels[level].conservative;
    if (rate < minimum) reasons.push(`L${level} is ${rate.toFixed(1)}% (needs ${minimum}%)`);
  }
  for (const result of results.filter((item) => item.scope === 'app' && item.status === 'FAIL')) {
    reasons.push(
      `${result.id} fails for ${result.apps
        .filter((app) => app.status === 'FAIL')
        .map((app) => app.app)
        .join(', ')}`,
    );
  }
  if (strict) {
    for (const result of results.filter((item) => item.status === 'SKIP' && item.skippedBy === 'gh'))
      reasons.push(`${result.id} was skipped (gh unavailable)`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function selectApps(projects, argv, config) {
  const flagIndex = argv.indexOf('--apps');
  const requested = flagIndex >= 0 ? (argv[flagIndex + 1] ?? '').split(',').filter(Boolean) : null;
  if (requested) return { ...projects, apps: requested.filter((name) => projects.apps.includes(name)) };
  if (argv.includes('--all')) return projects;
  return { ...projects, apps: projects.apps.filter((name) => config.defaultApps.includes(name)) };
}

export function audit(root, argv, overrides = {}) {
  const config = loadCriteria(root);
  const context = createContext(root, overrides);
  const projects = selectApps(discoverProjects(root), argv, config);
  const results = config.criteria.map((criterion) => {
    const outcome = evaluateCriterion(criterion, context, projects);
    const skippedBy =
      outcome.status === 'SKIP' && JSON.stringify(criterion.checker).includes('"type":"gh"') ? 'gh' : undefined;
    return {
      id: criterion.id,
      pillar: criterion.pillar,
      level: criterion.level,
      scope: criterion.scope,
      skippedBy,
      ...outcome,
    };
  });
  const levels = levelRates(results);
  return { projects, results, levels, decision: decide(results, levels, { strict: argv.includes('--strict') }) };
}

function formatReport({ projects, results, levels, decision }) {
  const lines = [
    `Apps evaluated: ${projects.apps.join(', ') || 'none'}; libraries: ${projects.libraries.join(', ') || 'none'}`,
    '',
  ];
  for (const result of results)
    lines.push(`${result.status.padEnd(4)} L${result.level} ${result.id.padEnd(34)} ${result.evidence}`);
  const appCriteria = results.filter((result) => result.scope === 'app');
  for (const app of [...projects.apps, ...projects.libraries]) {
    const own = appCriteria.flatMap((result) =>
      result.apps.filter((entry) => entry.app === app).map((entry) => ({ id: result.id, ...entry })),
    );
    if (own.length === 0) continue;
    const count = (status) => own.filter((entry) => entry.status === status).length;
    lines.push('', `App ${app}: ${count('PASS')} pass, ${count('FAIL')} fail, ${count('SKIP')} n/a`);
    for (const entry of own.filter((item) => item.status === 'FAIL'))
      lines.push(`  FAIL ${entry.id}: ${entry.evidence}`);
  }
  lines.push('', 'Level  pass/total  skipped  rate (skips count as not passed)  rate (skips excluded)');
  for (const [level, item] of Object.entries(levels)) {
    lines.push(
      `L${level}     ${`${item.passed}/${item.total}`.padEnd(11)} ${String(item.skipped).padEnd(8)} ${`${item.conservative.toFixed(1)}%`.padEnd(34)} ${item.evaluated.toFixed(1)}%`,
    );
  }
  const failing = results.filter((result) => result.status === 'FAIL');
  lines.push('', failing.length ? `Failing: ${failing.map((result) => result.id).join(', ')}` : 'No failing criteria.');
  lines.push(decision.ok ? 'Result: OK' : `Result: NOT OK (${decision.reasons.join('; ')})`);
  return lines.join('\n');
}

export function main(argv, root = repoRoot(), overrides = {}) {
  const report = audit(root, argv, overrides);
  if (argv.includes('--json')) {
    const { projects, results, levels, decision } = report;
    console.log(
      JSON.stringify(
        { projects, levels, decision, criteria: results.map(({ skippedBy: _skippedBy, ...rest }) => rest) },
        null,
        2,
      ),
    );
  } else {
    console.log(formatReport(report));
  }
  return report.decision.ok ? 0 : 1;
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
