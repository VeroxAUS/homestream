import { readFileSync } from 'node:fs';
import path from 'node:path';
import { git, isMain, repoRoot, splitNul } from './lib/util.mjs';

/**
 * Counts TODO / FIXME / HACK markers in source files per package and fails when a marker type goes over the budget in
 * techdebt.config.json. Lower the budget when markers are resolved; never raise it to fit new markers. How entries are
 * tracked is described in docs/TECH_DEBT.md.
 */

export const MARKERS = ['TODO', 'FIXME', 'HACK'];
const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|cts|js|mjs|cjs|kt|kts|css|html)$/;
/** Generated output, vendored docs and this tool's own sources (which spell out the marker words). */
const SKIP_PATHS = [
  /^droid-wiki\//,
  /^\.factory\//,
  /^scripts\/techdebt\.mjs$/,
  /^apps\/server\/test\/scripts\/techdebt\.test\.ts$/,
];
const MARKER_REGEX = new RegExp(`\\b(${MARKERS.join('|')})\\b`, 'g');

export function packageOf(file) {
  const [first, second] = file.split('/');
  return first === 'apps' || first === 'packages' ? `${first}/${second}` : '(root)';
}

/** `{ 'apps/server': {TODO: 1, FIXME: 0, HACK: 0}, ... }` for file contents keyed by path. */
export function countMarkers(files) {
  const counts = {};
  for (const [file, content] of files) {
    const pkg = packageOf(file);
    counts[pkg] ??= Object.fromEntries(MARKERS.map((marker) => [marker, 0]));
    for (const match of content.matchAll(MARKER_REGEX)) counts[pkg][match[1]] += 1;
  }
  return counts;
}

export function totals(counts) {
  return Object.fromEntries(
    MARKERS.map((marker) => [marker, Object.values(counts).reduce((sum, c) => sum + c[marker], 0)]),
  );
}

export function overBudget(total, budget) {
  return MARKERS.filter((marker) => total[marker] > (budget[marker] ?? 0));
}

function readSources(root) {
  const files = splitNul(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root }));
  return files
    .filter((file) => SOURCE_EXTENSIONS.test(file) && !SKIP_PATHS.some((skip) => skip.test(file)))
    .flatMap((file) => {
      try {
        return [[file, readFileSync(path.join(root, file), 'utf8')]];
      } catch {
        return [];
      }
    });
}

export function main(root = repoRoot()) {
  const budget = JSON.parse(readFileSync(path.join(root, 'techdebt.config.json'), 'utf8')).budget;
  const counts = countMarkers(readSources(root));
  const total = totals(counts);

  console.log(`Tech debt markers per package (budget: ${MARKERS.map((m) => `${m} <= ${budget[m] ?? 0}`).join(', ')})`);
  for (const [pkg, c] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${pkg.padEnd(18)} ${MARKERS.map((m) => `${m} ${c[m]}`).join('  ')}`);
  }
  console.log(`  ${'total'.padEnd(18)} ${MARKERS.map((m) => `${m} ${total[m]}`).join('  ')}`);

  const exceeded = overBudget(total, budget);
  for (const marker of exceeded)
    console.error(`[techdebt] ${marker} count ${total[marker]} is over the budget of ${budget[marker] ?? 0}`);
  if (exceeded.length > 0)
    console.error('[techdebt] Resolve the markers or record the debt in docs/TECH_DEBT.md and agree a new budget.');
  return exceeded.length > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) process.exit(main());
