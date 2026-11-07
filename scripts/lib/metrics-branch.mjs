import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { recordFileName } from './ci-timing.mjs';

/**
 * The `ci-metrics` branch: an orphan branch that only ever receives timing records (`runs/*.json`) and never touches
 * main. Records are kept indefinitely; nothing here deletes or rewrites one.
 */

const METRICS_BRANCH = 'ci-metrics';
const PUSH_ATTEMPTS = 4;
const BOT = [
  '-c',
  'user.name=github-actions[bot]',
  '-c',
  'user.email=41898282+github-actions[bot]@users.noreply.github.com',
];

const README = `# ci-metrics

Timing records of the CI runs on main, one JSON file per run in \`runs/\`. Written by the "CI timing" job of
.github/workflows/ci.yml (scripts/ci-timing.mjs); nothing else is stored here and nothing is ever deleted.
See docs/ci.md in the main branch for the format and how the comparison works.
`;

/** Git credentials go through the environment so they never appear in an argument list or an error message. */
function gitEnv(token) {
  if (!token) return process.env;
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

function runGit(args, { cwd, token }) {
  try {
    return execFileSync('git', args, {
      cwd,
      env: gitEnv(token),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    const detail = String(error.stderr ?? error.message)
      .replace(/\s+/g, ' ')
      .slice(0, 300);
    const subcommand = args.find((arg) => !arg.startsWith('-') && !arg.includes('='));
    throw new Error(`git ${subcommand} failed: ${detail}`, { cause: error });
  }
}

function branchExists(remote, token) {
  try {
    return runGit(['ls-remote', '--heads', remote, METRICS_BRANCH], { token }).trim() !== '';
  } catch (error) {
    throw new Error(`could not list the branches of the remote: ${error.message}`, { cause: error });
  }
}

/** A working copy of the ci-metrics branch in `dir`: a clone when the branch exists, an empty orphan repository when not. */
export function openMetrics({ remote, dir, token }) {
  if (branchExists(remote, token)) {
    runGit(['clone', '--quiet', '--depth', '1', '--branch', METRICS_BRANCH, '--single-branch', remote, dir], { token });
    return { created: false };
  }
  mkdirSync(dir, { recursive: true });
  runGit(['init', '--quiet', '--initial-branch', METRICS_BRANCH], { cwd: dir });
  runGit(['remote', 'add', 'origin', remote], { cwd: dir });
  return { created: true };
}

/** All parsable records in the working copy. Files that are not valid records are ignored, never fatal. */
export function readRecords(dir) {
  const runs = path.join(dir, 'runs');
  if (!existsSync(runs)) return [];
  return readdirSync(runs)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      try {
        const record = JSON.parse(readFileSync(path.join(runs, name), 'utf8'));
        return record?.run && Array.isArray(record.jobs) ? [record] : [];
      } catch {
        return [];
      }
    });
}

/** Adds the record as one commit on ci-metrics and pushes it; a push that lost a race is rebased and retried. */
export async function publishRecord({ dir, record, token, sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const relative = recordFileName(record);
  const file = path.join(dir, relative);
  if (existsSync(file)) return { file: relative, pushed: false };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 1)}\n`);
  const readme = path.join(dir, 'README.md');
  if (!existsSync(readme)) writeFileSync(readme, README);
  runGit(['add', '--', 'README.md', relative], { cwd: dir });
  runGit([...BOT, 'commit', '--quiet', '-m', `ci: timing of run ${record.run.id}`], { cwd: dir });
  let lastError;
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt += 1) {
    try {
      runGit(['push', '--quiet', 'origin', `HEAD:refs/heads/${METRICS_BRANCH}`], { cwd: dir, token });
      return { file: relative, pushed: true };
    } catch (error) {
      lastError = error;
      runGit(['fetch', '--quiet', 'origin', METRICS_BRANCH], { cwd: dir, token });
      runGit([...BOT, 'rebase', '--quiet', `origin/${METRICS_BRANCH}`], { cwd: dir });
      await sleepImpl(attempt * 500);
    }
  }
  throw lastError;
}
