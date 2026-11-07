// Starts the built desktop app from the source tree: pnpm --filter @homestream/desktop start [-- flags]
// Everything after the script name goes to the app, so Chromium switches work too:
//   pnpm --filter @homestream/desktop start -- --remote-debugging-port=8622 --user-data-dir=D:\HomeStream\electron-validate
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The Electron binary is downloaded on demand; keep that cache off the system drive.
if (process.platform === 'win32') process.env.ELECTRON_CACHE ||= 'E:\\HomeStream\\cache\\electron';
// A leftover flag (some editors set it) would make Electron run as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

if (!existsSync(path.join(appDir, 'dist', 'main.js'))) {
  console.error('The desktop app is not built. Run: pnpm --filter @homestream/desktop build');
  process.exit(1);
}

let electron;
try {
  electron = createRequire(import.meta.url)('electron');
} catch {
  console.error(
    'The Electron binary is missing. Run once: node apps/desktop/node_modules/electron/install.js (with ELECTRON_CACHE set).',
  );
  process.exit(1);
}

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const child = spawn(electron, [appDir, ...args], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (error) => {
  console.error(`Could not start Electron: ${error.message}`);
  process.exit(1);
});
