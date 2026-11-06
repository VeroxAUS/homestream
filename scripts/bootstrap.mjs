import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/util.mjs';

/**
 * One command from a fresh clone to a working checkout: `node scripts/bootstrap.mjs` (or `pnpm bootstrap` once pnpm is
 * installed). It only uses Node built-ins so it runs before any dependency exists, and it is safe to run again:
 * an existing `.env` is never touched.
 */

export const REQUIRED_NODE_MAJOR = 24;

const repoRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Runs one command line in the repository root and returns whether it succeeded. A single string, as `pnpm` is a .cmd shim on Windows. */
export function runCommand(command, cwd = repoRootDir) {
  return spawnSync(command, { cwd, stdio: 'inherit', shell: true, windowsHide: true }).status === 0;
}

/** Output of a command, or null when it cannot run. */
export function readCommand(command, cwd = repoRootDir) {
  const result = spawnSync(command, { cwd, encoding: 'utf8', shell: true, windowsHide: true });
  return result.status === 0 ? result.stdout : null;
}

export function nodeMajor(version = process.versions.node) {
  return Number.parseInt(version.split('.')[0] ?? '', 10);
}

/** Copies `.env.example` to `.env` when `.env` is absent. Returns 'created', 'kept' or 'missing-template'. */
export function ensureEnvFile(root) {
  const target = path.join(root, '.env');
  const template = path.join(root, '.env.example');
  if (existsSync(target)) return 'kept';
  if (!existsSync(template)) return 'missing-template';
  copyFileSync(template, target);
  return 'created';
}

export function describeFfmpeg(encodersOutput) {
  if (encodersOutput === null) {
    return {
      level: 'warn',
      text: 'ffmpeg was not found on PATH. Unit tests still pass, but playback needs ffmpeg (with NVENC for GPU encoding). Install it, or set FFMPEG_PATH and FFPROBE_PATH in .env.',
    };
  }
  if (!/nvenc/i.test(encodersOutput)) {
    return {
      level: 'warn',
      text: 'ffmpeg has no NVENC encoders. That is fine for development and tests; real playback needs an NVIDIA GPU build.',
    };
  }
  return { level: 'ok', text: 'ffmpeg with NVENC found.' };
}

const log = (message) => console.log(`[bootstrap] ${message}`);
const warn = (message) => console.warn(`[bootstrap] warning: ${message}`);
const fail = (message) => console.error(`[bootstrap] error: ${message}`);

/**
 * @param {object} [deps] Replaceable for tests.
 * @returns {number} Process exit code.
 */
export function bootstrap({
  root = repoRootDir,
  run = runCommand,
  read = readCommand,
  version = process.versions.node,
  isCi = Boolean(process.env.CI),
} = {}) {
  log(`repository: ${root}`);

  if (nodeMajor(version) !== REQUIRED_NODE_MAJOR) {
    fail(
      `Node ${REQUIRED_NODE_MAJOR} is required (found ${version}). Install it from https://nodejs.org or with nvm/fnm (see .nvmrc), then run this again.`,
    );
    return 1;
  }
  log(`Node ${version} ok`);

  const pnpmVersion = read('pnpm --version');
  if (pnpmVersion === null) {
    fail(
      'pnpm was not found. Install it with `npm install --global pnpm` (or `corepack enable`), then run this again.',
    );
    return 1;
  }
  log(`pnpm ${pnpmVersion.trim()} ok`);

  const ffmpeg = describeFfmpeg(read('ffmpeg -hide_banner -encoders'));
  if (ffmpeg.level === 'warn') warn(ffmpeg.text);
  else log(ffmpeg.text);

  log('installing dependencies (pnpm install --frozen-lockfile)');
  if (!run('pnpm install --frozen-lockfile', root)) {
    fail('pnpm install failed. Fix the error above and run this again.');
    return 1;
  }

  if (!isCi && existsSync(path.join(root, '.git'))) {
    log('installing git hooks');
    if (!run('pnpm exec lefthook install', root))
      warn('could not install git hooks; run `pnpm exec lefthook install`.');
  } else {
    log('skipping git hooks (CI or no .git directory)');
  }

  const env = ensureEnvFile(root);
  if (env === 'created') log('created .env from .env.example (fill in your keys; .env is never committed)');
  else if (env === 'kept') log('.env already exists, left untouched');
  else warn('.env.example is missing, so no .env was created');

  log('building packages/shared');
  if (!run('pnpm --filter @homestream/shared build', root)) {
    fail('building @homestream/shared failed. Fix the error above and run this again.');
    return 1;
  }

  console.log(`
[bootstrap] Done. Next steps:
  1. Edit .env and set GATEWAY_MANIFEST_URL and TMDB_READ_TOKEN (see the comments inside).
  2. pnpm test:unit          run the fast tests (no network, GPU or keys needed)
  3. pnpm build              build the web UI and the server
  4. pnpm --filter @homestream/server start    start the server on http://localhost:8600
  5. Open http://localhost:8600/api/docs for the API reference.
See README.md and AGENTS.md for more.`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(bootstrap());
