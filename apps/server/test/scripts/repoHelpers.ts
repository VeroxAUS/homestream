import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../helpers.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

function scriptPath(name: string): string {
  return path.join(repoRoot, 'scripts', name);
}

/** A throwaway git repository outside the real one, for scripts that read the index. */
export function makeTempRepo(prefix: string): string {
  const dir = makeTempDir(prefix);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', windowsHide: true });
  git('init', '-q');
  git('config', 'user.email', 'test@example.test');
  git('config', 'user.name', 'Test');
  git('config', 'core.autocrlf', 'false');
  return dir;
}

export function writeAndStage(dir: string, file: string, content: string | Buffer): void {
  const full = path.join(dir, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
  execFileSync('git', ['add', '--', file], { cwd: dir, stdio: 'ignore', windowsHide: true });
}

export interface ScriptResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runScript(
  dir: string,
  script: string,
  args: string[] = [],
  env: Record<string, string> = {},
): ScriptResult {
  const result = spawnSync(process.execPath, [scriptPath(script), ...args], {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
