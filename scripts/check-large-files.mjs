import { statSync } from 'node:fs';
import path from 'node:path';
import { git, isMain, repoRoot, splitNul } from './lib/util.mjs';

export const LIMIT_BYTES = 1024 * 1024;
/** Files that legitimately grow past the limit. */
export const ALLOWLIST = new Set(['pnpm-lock.yaml']);

/** Files over the limit, as `{file, bytes}`. */
export function findLargeFiles(entries, limit = LIMIT_BYTES) {
  return entries.filter(({ file, bytes }) => bytes > limit && !ALLOWLIST.has(path.posix.basename(file)));
}

function stagedEntries(cwd) {
  const files = splitNul(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd }));
  return files.map((file) => ({ file, bytes: Number(git(['cat-file', '-s', `:${file}`], { cwd }).trim()) }));
}

function treeEntries(cwd) {
  const files = splitNul(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd }));
  return files.flatMap((file) => {
    try {
      return [{ file, bytes: statSync(path.join(cwd, file)).size }];
    } catch {
      return [];
    }
  });
}

export function main(argv, cwd = repoRoot()) {
  const whole = argv.includes('--all');
  const offenders = findLargeFiles(whole ? treeEntries(cwd) : stagedEntries(cwd));
  for (const { file, bytes } of offenders) {
    console.error(`[large-files] ${file} is ${(bytes / 1024 / 1024).toFixed(2)} MB, over the ${LIMIT_BYTES / 1024 / 1024} MB limit`);
  }
  if (offenders.length > 0) {
    console.error('[large-files] Keep large binaries out of git (generate them, or download them in a setup script).');
    return 1;
  }
  console.log(`[large-files] ok (limit ${LIMIT_BYTES / 1024 / 1024} MB, ${whole ? 'whole tree' : 'staged files'})`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));