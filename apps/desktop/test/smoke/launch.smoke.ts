import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluate } from './cdp.js';
import { quitShell, startShell, teardownSmoke, until, type Shell } from './harness.js';

// Starts the real Electron shell with the built server and web UI, in a throw-away user-data and data folder, and
// drives it over DevTools. Needs: pnpm build (shared, server, web), pnpm --filter @homestream/desktop build, and the
// Electron binary (ELECTRON_CACHE set, node apps/desktop/node_modules/electron/install.js once).
// This file is the first run (no keys); configured.smoke.ts is the same shell with keys, where Home renders.
const SERVER_PORT = 8616;
const DEBUG_PORT = 8617;
const BRIDGE_KEYS = [
  'closeMiniPlayer',
  'getDesktopSettings',
  'getServerStatus',
  'getShellState',
  'getStartWithWindows',
  'isDesktop',
  'isMiniPlayer',
  'onHandover',
  'openConfig',
  'openLogs',
  'openMiniPlayer',
  'quit',
  'reportPlaying',
  'restartServer',
  'retry',
  'returnToMain',
  'setDesktopSetting',
  'setMiniAlwaysOnTop',
  'setStartWithWindows',
  'version',
];

describe('Electron launch smoke test: first run', () => {
  let shell: Shell;

  beforeAll(async () => {
    shell = await startShell({
      prefix: 'hs-smoke-',
      serverPort: SERVER_PORT,
      debugPort: DEBUG_PORT,
      // An env file that does not exist: no developer .env or %APPDATA% config is picked up, so this is a first run.
      env: (root) => ({ HOMESTREAM_ENV_FILE: path.join(root, 'none.env') }),
    });
  }, 150_000);

  afterAll(() => teardownSmoke({ shell }));

  it('shows the web UI in the window with exactly the 20 bridge members', async () => {
    const keys = (await evaluate(shell.page, 'Object.keys(window.homestream).sort()')) as string[];
    expect(keys).toEqual(BRIDGE_KEYS);
    expect(await evaluate(shell.page, 'window.homestream.isDesktop')).toBe(true);
    expect(await evaluate(shell.page, 'window.homestream.isMiniPlayer')).toBe(false);
  });

  it('runs the server it spawned and reports it in the status line', async () => {
    const status = await evaluate(shell.page, 'window.homestream.getServerStatus()');
    expect(status).toMatch(/^Server: running \(spawned, pid \d+\)$/);
  });

  it('keeps a tray and a visible window, and tells the user to finish setting up on a first run', async () => {
    const state = (await evaluate(shell.page, 'window.homestream.getShellState()')) as {
      tray: { tooltip: string };
      window: { visible: boolean };
    };
    expect(state.tray.tooltip).toMatch(/^HomeStream\n/);
    expect(state.window.visible).toBe(true);
    await until('the first-run screen', 30_000, async () =>
      String(await evaluate(shell.page, 'document.body.innerText')).includes('Finish setting up'),
    );
  });

  it('saves a desktop setting to desktop-settings.json in the user-data folder', async () => {
    await evaluate(shell.page, "window.homestream.setDesktopSetting('notifyReady', false)");
    const file = path.join(shell.root, 'user', 'desktop-settings.json');
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(saved.notifyReady).toBe(false);
  });

  it('a second launch with --quit ends the app and the server it started', async () => {
    const result = await quitShell(shell);
    expect(result).toEqual({ launcherStatus: 0, exitCode: 0, serverStillUp: false, leftovers: [] });
  }, 120_000);
});
