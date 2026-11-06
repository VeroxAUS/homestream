import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Runs from the root `prepare` script, so `pnpm install` leaves the lefthook git hooks in place. It is skipped where
// hooks make no sense: CI, and source trees without a .git directory (archives, some container builds).
if (process.env.CI || !existsSync('.git')) {
  console.log('[hooks] skipped (CI or no .git directory)');
} else {
  const result = spawnSync('lefthook', ['install'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) console.warn('[hooks] lefthook install failed; run pnpm exec lefthook install');
}
