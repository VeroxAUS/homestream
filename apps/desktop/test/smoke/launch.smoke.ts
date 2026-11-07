import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluate, listTargets, type CdpTarget } from './cdp.js';

// Starts the real Electron shell with the built server and web UI, in a throw-away user-data and data folder, and
// drives it over DevTools. Needs: pnpm build (shared, server, web), pnpm --filter @homestream/desktop build, and the
// Electron binary (ELECTRON_CACHE set, node apps/desktop/node_modules/electron/install.js once).
const SERVER_PORT = 8616;
const DEBUG_PORT = 8617;
const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
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

function requirePrerequisites(): void {
  const missing = [
    ['apps/desktop/dist/main.js', 'pnpm --filter @homestream/desktop build'],
    ['apps/server/dist/index.js', 'pnpm --filter @homestream/server build'],
    ['apps/web/dist/index.html', 'pnpm --filter @homestream/web build'],
  ].filter(([file]) => !existsSync(path.join(repoRoot, file!)));
  if (missing.length > 0) {
    throw new Error(`Build first: ${missing.map(([file, fix]) => `${fix} (missing ${file})`).join('; ')}`);
  }
  createRequire(import.meta.url)(path.join(desktopDir, 'node_modules', 'electron'));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until<T>(what: string, timeoutMs: number, probe: () => Promise<T | false | undefined>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${what}${last ? ` (${last})` : ''}`);
}

const serverUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/info`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
};

describe('Electron launch smoke test', () => {
  let root = '';
  let app: ChildProcess | null = null;
  let exitCode: number | null | undefined;
  let page: CdpTarget;

  const launchArgs = () => [
    path.join(desktopDir, 'scripts', 'start.mjs'),
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${path.join(root, 'user')}`,
  ];

  beforeAll(async () => {
    requirePrerequisites();
    root = mkdtempSync(path.join(process.env.HOMESTREAM_TEST_ROOT ?? tmpdir(), 'hs-smoke-'));
    mkdirSync(path.join(root, 'user'), { recursive: true });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(SERVER_PORT),
      DATA_DIR: path.join(root, 'data'),
      TRANSCODE_DIR: path.join(root, 'transcode'),
      // An env file that does not exist: no developer .env or %APPDATA% config is picked up, so this is a first run.
      HOMESTREAM_ENV_FILE: path.join(root, 'none.env'),
      HOMESTREAM_MDNS: 'off',
      HOMESTREAM_TELEMETRY: 'off',
      SOURCE_PROXY_PORT: '0',
      LOG_LEVEL: 'warn',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = spawn('node', launchArgs(), { env, stdio: 'ignore', windowsHide: false });
    app.on('exit', (code) => {
      exitCode = code;
    });
    await until('the server to answer', 60_000, serverUp);
    page = await until('the app window', 60_000, async () =>
      (await listTargets(DEBUG_PORT)).find(
        (target) => target.type === 'page' && target.url.includes(`:${SERVER_PORT}/`),
      ),
    );
  }, 150_000);

  afterAll(() => {
    if (app?.pid && exitCode === undefined)
      spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  });

  it('shows the web UI in the window with exactly the 20 bridge members', async () => {
    const keys = (await evaluate(page, 'Object.keys(window.homestream).sort()')) as string[];
    expect(keys).toEqual(BRIDGE_KEYS);
    expect(await evaluate(page, 'window.homestream.isDesktop')).toBe(true);
    expect(await evaluate(page, 'window.homestream.isMiniPlayer')).toBe(false);
  });

  it('runs the server it spawned and reports it in the status line', async () => {
    const status = await evaluate(page, 'window.homestream.getServerStatus()');
    expect(status).toMatch(/^Server: running \(spawned, pid \d+\)$/);
  });

  it('keeps a tray and a visible window, and tells the user to finish setting up on a first run', async () => {
    const state = (await evaluate(page, 'window.homestream.getShellState()')) as {
      tray: { tooltip: string };
      window: { visible: boolean };
    };
    expect(state.tray.tooltip).toMatch(/^HomeStream\n/);
    expect(state.window.visible).toBe(true);
    await until('the first-run screen', 30_000, async () =>
      String(await evaluate(page, 'document.body.innerText')).includes('Finish setting up'),
    );
  });

  it('saves a desktop setting to desktop-settings.json in the user-data folder', async () => {
    await evaluate(page, "window.homestream.setDesktopSetting('notifyReady', false)");
    const file = path.join(root, 'user', 'desktop-settings.json');
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(saved.notifyReady).toBe(false);
  });

  it('a second launch with --quit ends the app and the server it started', async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const second = spawnSync('node', [...launchArgs(), '--quit'], { env, timeout: 30_000, stdio: 'ignore' });
    expect(second.status).toBe(0);
    await until('the app to exit', 30_000, async () => exitCode !== undefined);
    expect(exitCode).toBe(0);
    expect(await serverUp()).toBe(false);
  }, 90_000);
});
