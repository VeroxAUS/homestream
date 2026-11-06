import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, repoRoot } from './lib/util.mjs';

/**
 * Raises each package's coverage-thresholds.json to the measured coverage minus MARGIN points (rounded down) and never
 * lowers it. Measures first (`pnpm -r test:coverage`) unless --no-run is given. With --check it writes nothing and
 * exits 1 when a threshold could be raised, so a stale threshold is noticed.
 */

const METRICS = ['lines', 'functions', 'branches', 'statements'];
export const MARGIN = 2;

export function ratchet(current, measured, margin = MARGIN) {
  const next = { ...current };
  for (const metric of METRICS) {
    const target = Math.max(0, Math.floor(measured[metric].pct) - margin);
    if (target > (current[metric] ?? 0)) next[metric] = target;
  }
  return next;
}

function packageDirs(root) {
  return ['apps', 'packages'].flatMap((group) => {
    const dir = path.join(root, group);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((name) => path.join(dir, name))
      .filter((pkg) => existsSync(path.join(pkg, 'coverage-thresholds.json')));
  });
}

function measure(root) {
  const run = spawnSync('pnpm', ['-r', '--workspace-concurrency=1', 'run', 'test:coverage'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return run.status ?? 1;
}

/** Prints one package's table and returns the thresholds after ratcheting, or null without a coverage summary. */
function reviewPackage(root, dir) {
  const name = path.relative(root, dir).replaceAll('\\', '/');
  const summaryFile = path.join(dir, 'coverage', 'coverage-summary.json');
  if (!existsSync(summaryFile)) {
    console.error(`[ratchet] ${name}: no coverage summary, run pnpm test:coverage first`);
    return null;
  }
  const current = JSON.parse(readFileSync(path.join(dir, 'coverage-thresholds.json'), 'utf8'));
  const measured = JSON.parse(readFileSync(summaryFile, 'utf8')).total;
  const next = ratchet(current, measured);
  for (const metric of METRICS) {
    const note = next[metric] > current[metric] ? ` -> ${next[metric]} (raise)` : '';
    console.log(`${name.padEnd(16)} ${metric.padEnd(11)} threshold ${String(current[metric]).padStart(3)}  measured ${measured[metric].pct}${note}`);
  }
  return { current, next };
}

export function main(argv, root = repoRoot()) {
  const check = argv.includes('--check');
  if (!argv.includes('--no-run')) {
    const status = measure(root);
    if (status !== 0) return status;
  }

  let raised = 0;
  for (const dir of packageDirs(root)) {
    const review = reviewPackage(root, dir);
    if (!review) return 1;
    const changed = METRICS.filter((metric) => review.next[metric] > review.current[metric]).length;
    raised += changed;
    if (changed > 0 && !check) writeFileSync(path.join(dir, 'coverage-thresholds.json'), `${JSON.stringify(review.next, null, 2)}\n`);
  }
  if (raised === 0) console.log('Thresholds are up to date.');
  else console.log(check ? `${raised} threshold(s) can be raised: run pnpm coverage:ratchet.` : `${raised} threshold(s) raised. Commit the change.`);
  return check && raised > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
