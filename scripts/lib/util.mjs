import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** True when the module is the entry point (not imported by a test). */
export function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return metaUrl === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

/** Runs git with an args array (no shell) and returns stdout. */
export function git(args, { cwd = process.cwd(), maxBuffer = 64 * 1024 * 1024 } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function repoRoot(cwd = process.cwd()) {
  return git(['rev-parse', '--show-toplevel'], { cwd }).trim();
}

/** NUL-separated git output as a list. */
export function splitNul(output) {
  return output.split('\0').filter(Boolean);
}
