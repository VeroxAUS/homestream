import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import {
  BASELINE_FILE,
  COUNT_OPTIONS,
  MAX_FILE_LINES,
  MAX_FUNCTION_LINES,
  isTestFile,
  readBaseline,
} from './lib/code-limits.mjs';
import { git, isMain, repoRoot } from './lib/util.mjs';

/**
 * Keeps the line-limit baseline honest (docs/TECH_DEBT.md, "Line limits"). ESLint enforces `max-lines` and
 * `max-lines-per-function` with the ceilings of code-limits.baseline.json. This check makes sure that
 *  - a ceiling equals the measured size of its file (ceilings follow files down, an entry goes when the file is within
 *    the limit, an entry for a missing file goes), and
 *  - no entry was added or raised compared with the previous commit on main (git only, no network).
 * `--write` lowers ceilings to the measured size and drops entries that are no longer needed. `--init` also adds
 * entries; it exists for creating the baseline and is caught by the comparison with main.
 */

const SIZE_MESSAGE = /\((\d+)\)\. Maximum allowed/;

/** `{ lines, functionLines }` of one ESLint result measured with the limits turned down to zero. */
export function sizesFromMessages(messages) {
  let lines = 0;
  let functionLines = 0;
  for (const { ruleId, message } of messages) {
    const size = Number(SIZE_MESSAGE.exec(message)?.[1]);
    if (!Number.isFinite(size)) continue;
    if (ruleId === 'max-lines') lines = size;
    else if (ruleId === 'max-lines-per-function') functionLines = Math.max(functionLines, size);
  }
  return { lines, functionLines };
}

/** Errors for ceilings that differ from the measured sizes. `measured` maps path to sizes, `null` for a missing file. */
export function ceilingErrors(baseline, measured) {
  const errors = [];
  for (const [file, ceiling] of Object.entries(baseline.files)) {
    const size = measured[file];
    if (!size) {
      errors.push(`${file}: listed in ${BASELINE_FILE} but the file does not exist. Delete the entry.`);
      continue;
    }
    if (!ceiling.lines && !ceiling.functionLines) errors.push(`${file}: entry has no ceiling. Delete it.`);
    errors.push(...ceilingError(file, 'lines', ceiling.lines, size.lines, MAX_FILE_LINES));
    if (!isTestFile(file))
      errors.push(
        ...ceilingError(file, 'functionLines', ceiling.functionLines, size.functionLines, MAX_FUNCTION_LINES),
      );
  }
  return errors;
}

function ceilingError(file, key, ceiling, size, limit) {
  if (ceiling === undefined) return [];
  if (size <= limit) return [`${file}: ${key} is ${size}, within the limit of ${limit}. Delete the ${key} ceiling.`];
  if (ceiling > size) return [`${file}: ${key} ceiling ${ceiling} is above the measured ${size}. Lower it to ${size}.`];
  if (ceiling < size) return [`${file}: ${key} is ${size}, over its ceiling of ${ceiling}. Split the code instead.`];
  return [];
}

/** Errors for entries added or raised in `current` compared with `base` (the baseline of the previous main commit). */
export function raisedErrors(base, current) {
  const errors = [];
  for (const [file, ceiling] of Object.entries(current.files)) {
    const before = base.files[file];
    for (const key of ['lines', 'functionLines']) {
      if (ceiling[key] === undefined) continue;
      if (before?.[key] === undefined)
        errors.push(`${file}: new ${key} ceiling ${ceiling[key]}. New code never gets a baseline entry; split it.`);
      else if (ceiling[key] > before[key])
        errors.push(`${file}: ${key} ceiling raised from ${before[key]} to ${ceiling[key]}. Ceilings only go down.`);
    }
  }
  return errors;
}

/** The baseline with every ceiling lowered to the measured size and every satisfied ceiling dropped. */
export function shrunkBaseline(baseline, measured, { add = false } = {}) {
  const files = {};
  const names = add ? new Set([...Object.keys(baseline.files), ...Object.keys(measured)]) : Object.keys(baseline.files);
  for (const file of [...names].sort()) {
    const size = measured[file];
    if (!size) continue;
    const entry = {};
    const tracked = baseline.files[file];
    if ((tracked?.lines !== undefined || add) && size.lines > MAX_FILE_LINES)
      entry.lines = Math.min(size.lines, tracked?.lines ?? size.lines);
    if (!isTestFile(file) && (tracked?.functionLines !== undefined || add) && size.functionLines > MAX_FUNCTION_LINES)
      entry.functionLines = Math.min(size.functionLines, tracked?.functionLines ?? size.functionLines);
    if (Object.keys(entry).length > 0) files[file] = entry;
  }
  return { files };
}

function limitedEslint(root) {
  const zero = ['error', { max: 0, ...COUNT_OPTIONS }];
  return new ESLint({
    cwd: root,
    overrideConfigFile: true,
    ignore: false,
    overrideConfig: [
      {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: { parser: tseslint.parser },
        rules: { 'max-lines': zero, 'max-lines-per-function': zero },
      },
    ],
  });
}

/** Measures files (repo-relative paths); a missing file maps to `null`. */
export async function measure(root, files) {
  const eslint = limitedEslint(root);
  const measured = {};
  const existing = [];
  for (const file of files) {
    try {
      git(['ls-files', '--error-unmatch', '--', file], { cwd: root });
      existing.push(file);
    } catch {
      measured[file] = null;
    }
  }
  const results = existing.length > 0 ? await eslint.lintFiles(existing) : [];
  for (const result of results) {
    const file = path.relative(root, result.filePath).split(path.sep).join('/');
    measured[file] = sizesFromMessages(result.messages);
  }
  return measured;
}

function trackedSources(root) {
  const out = git(['ls-files', '-z', '--', 'apps', 'packages'], { cwd: root });
  return out.split('\0').filter((file) => /^(apps|packages)\/.*\.tsx?$/.test(file) && !file.endsWith('.d.ts'));
}

/** The commit whose baseline the current one is compared with, or null when git cannot say. */
export function baseCommit(root) {
  try {
    const head = git(['rev-parse', 'HEAD'], { cwd: root }).trim();
    let mergeBase = head;
    try {
      mergeBase = git(['merge-base', head, 'refs/remotes/origin/main'], { cwd: root }).trim();
    } catch {
      // No origin/main (fresh clone without it): compare with the parent.
    }
    return git(['rev-parse', mergeBase === head ? `${head}^` : mergeBase], { cwd: root }).trim();
  } catch {
    return null;
  }
}

function baselineAt(root, commit) {
  try {
    return JSON.parse(git(['show', `${commit}:${BASELINE_FILE}`], { cwd: root }));
  } catch {
    return null;
  }
}

function writeBaseline(root, baseline) {
  writeFileSync(path.join(root, BASELINE_FILE), `${JSON.stringify(baseline, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2), root = repoRoot()) {
  const baseline = readBaseline(root);
  const init = argv.includes('--init');
  const files = init ? trackedSources(root) : Object.keys(baseline.files);
  const measured = await measure(root, files);

  if (init || argv.includes('--write')) {
    const next = shrunkBaseline(baseline, measured, { add: init });
    writeBaseline(root, next);
    console.log(`[code-limits] wrote ${BASELINE_FILE} with ${Object.keys(next.files).length} entries`);
    return 0;
  }

  const errors = ceilingErrors(baseline, measured);
  const base = baseCommit(root);
  const before = base ? baselineAt(root, base) : null;
  if (before) errors.push(...raisedErrors(before, baseline));
  else console.log('[code-limits] no baseline on the previous main commit, skipping the comparison with it');

  for (const error of errors) console.error(`[code-limits] ${error}`);
  if (errors.length > 0)
    console.error(`[code-limits] Fix the code, or lower ceilings with: node scripts/code-limits.mjs --write`);
  else console.log(`[code-limits] ok, ${Object.keys(baseline.files).length} baselined files`);
  return errors.length > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) process.exit(await main());
