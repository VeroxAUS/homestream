import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTargets, type CdpTarget } from './cdp.js';
import { removeFolder, runCleanups, stopPids, type TeardownOps } from './teardown.js';

export type { TeardownOps } from './teardown.js';

export const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const repoRoot = path.resolve(desktopDir, '..', '..');

export function requirePrerequisites(): void {
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

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function until<T>(
  what: string,
  timeoutMs: number,
  probe: () => Promise<T | false | undefined>,
): Promise<T> {
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

export const serverUp = async (port: number): Promise<boolean> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
};

/** What the window shows on the Home route, as read by `HOME_PROBE`. */
export interface HomeSnapshot {
  /** The `hs:home-content` performance mark exists. */
  marked: boolean;
  /** The first-run screen ("Finish setting up") is showing instead of Home. */
  setupScreen: boolean;
  headings: string[];
  /** Text of every poster card in the rows. */
  posterTitles: string[];
}

/**
 * Evaluated in the window. The content mark alone is not enough: the first-run screen, an error panel and Search set
 * it too, so the rows themselves are read as well.
 */
export const HOME_PROBE = `(() => ({
  marked: performance.getEntriesByName('hs:home-content').length > 0,
  setupScreen: String(document.body.innerText).includes('Finish setting up'),
  headings: Array.from(document.querySelectorAll('main h2'), (node) => String(node.textContent).trim()),
  posterTitles: Array.from(document.querySelectorAll('main section ul a'), (node) => String(node.textContent).trim()),
}))()`;

/** Home has rendered: the mark is set, the first-run screen is gone and the first poster row holds posters. */
export function isHomeRendered(snapshot: HomeSnapshot): boolean {
  return (
    snapshot.marked &&
    !snapshot.setupScreen &&
    snapshot.headings.includes('Trending Movies') &&
    snapshot.posterTitles.length > 0
  );
}

interface ProcessRow {
  pid: number;
  ppid: number;
}

/** Reads the Windows JSON table (one row or several) or the two-column `ps` output. */
export function parseProcessTable(text: string): ProcessRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as
      | Array<{ ProcessId: number; ParentProcessId: number }>
      | {
          ProcessId: number;
          ParentProcessId: number;
        };
    return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
      pid: row.ProcessId,
      ppid: row.ParentProcessId,
    }));
  }
  return trimmed.split(/\r?\n/).flatMap((line) => {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    return pid !== undefined && ppid !== undefined && Number.isInteger(pid) && Number.isInteger(ppid)
      ? [{ pid, ppid }]
      : [];
  });
}

/** Every process below `root`, however deep. Tolerates a cycle (a parent pid that was reused). */
export function descendantsOf(table: readonly ProcessRow[], root: number): number[] {
  const found = new Set<number>();
  const queue = [root];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const row of table) {
      if (row.ppid === parent && row.pid !== root && !found.has(row.pid)) {
        found.add(row.pid);
        queue.push(row.pid);
      }
    }
  }
  return [...found];
}

function processTable(): ProcessRow[] {
  const run =
    process.platform === 'win32'
      ? spawnSync(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
          ],
          { encoding: 'utf8', timeout: 30_000, windowsHide: true },
        )
      : spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 30_000 });
  return parseProcessTable(run.stdout);
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export interface Shell {
  root: string;
  serverPort: number;
  debugPort: number;
  app: ChildProcess;
  /** `undefined` while the launcher is still running. */
  exitCode(): number | null | undefined;
  /** Every pid the shell is known to have started (launcher, Electron and its children, the server), kept for teardown. */
  owned: Set<number>;
  page: CdpTarget;
}

export interface ShellOptions {
  prefix: string;
  serverPort: number;
  debugPort: number;
  /** Added to the base environment; an env file path under `root` is built by the caller. */
  env: (root: string) => NodeJS.ProcessEnv;
}

function launchArgs(root: string, debugPort: number): string[] {
  return [
    path.join(desktopDir, 'scripts', 'start.mjs'),
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${path.join(root, 'user')}`,
  ];
}

/** Starts the built shell in a throw-away folder under HOMESTREAM_TEST_ROOT and waits for the server and the window. */
export async function startShell(options: ShellOptions): Promise<Shell> {
  requirePrerequisites();
  const root = mkdtempSync(path.join(process.env.HOMESTREAM_TEST_ROOT ?? tmpdir(), options.prefix));
  mkdirSync(path.join(root, 'user'), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(options.serverPort),
    DATA_DIR: path.join(root, 'data'),
    TRANSCODE_DIR: path.join(root, 'transcode'),
    HOMESTREAM_MDNS: 'off',
    HOMESTREAM_TELEMETRY: 'off',
    SOURCE_PROXY_PORT: '0',
    LOG_LEVEL: 'warn',
    ...options.env(root),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn('node', launchArgs(root, options.debugPort), { env, stdio: 'ignore', windowsHide: false });
  let exitCode: number | null | undefined;
  app.on('exit', (code) => {
    exitCode = code;
  });
  const owned = new Set<number>(app.pid ? [app.pid] : []);
  const shell = {
    root,
    serverPort: options.serverPort,
    debugPort: options.debugPort,
    app,
    owned,
    exitCode: () => exitCode,
  };
  try {
    await until('the server to answer', 60_000, () => serverUp(options.serverPort));
    const page = await until('the app window', 60_000, async () =>
      (await listTargets(options.debugPort)).find(
        (target) => target.type === 'page' && target.url.includes(`:${options.serverPort}/`),
      ),
    );
    recordOwned(shell, realOps);
    return { ...shell, page };
  } catch (error) {
    await stopShell(shell).catch(() => undefined);
    throw error;
  }
}

export interface QuitResult {
  launcherStatus: number | null;
  exitCode: number | null | undefined;
  serverStillUp: boolean;
  /** Pids of the app's own processes (Electron and its children, the server) that were still alive after the quit. */
  leftovers: number[];
}

/** A second launch with --quit ends the app and the server it started; reports what is left afterwards. */
export async function quitShell(shell: Shell, extraPids: number[] = []): Promise<QuitResult> {
  recordOwned(shell, realOps);
  for (const pid of extraPids) shell.owned.add(pid);
  const tracked = [...shell.owned];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const second = spawnSync('node', [...launchArgs(shell.root, shell.debugPort), '--quit'], {
    env,
    timeout: 30_000,
    stdio: 'ignore',
  });
  await until('the app to exit', 30_000, async () => shell.exitCode() !== undefined);
  // Chromium's helper processes and the server can outlive the launcher by a moment.
  const leftovers = await until('the app processes to end', 20_000, async () =>
    tracked.every((pid) => !isAlive(pid)) ? [] : false,
  ).catch(() => tracked.filter(isAlive));
  return {
    launcherStatus: second.status,
    exitCode: shell.exitCode(),
    serverStillUp: await serverUp(shell.serverPort),
    leftovers,
  };
}

const realOps: TeardownOps = {
  isAlive,
  stop: (pid) => {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid)], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  },
  kill: (pid) => {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGKILL');
  },
  descendants: (pid) => descendantsOf(processTable(), pid),
  wait: sleep,
  removeDir: (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }),
};

interface ShellRecord {
  app: { pid?: number };
  root: string;
  owned: Set<number>;
}

/** Adds the launcher and everything below it, if the launcher still runs, to the pids kept for teardown. */
function recordOwned(shell: ShellRecord, ops: TeardownOps): void {
  const launcherPid = shell.app.pid;
  if (!launcherPid || !ops.isAlive(launcherPid)) return;
  shell.owned.add(launcherPid);
  for (const pid of ops.descendants(launcherPid)) shell.owned.add(pid);
}

async function stopShellProcesses(shell: ShellRecord, ops: TeardownOps): Promise<void> {
  recordOwned(shell, ops);
  // Whether the launcher exited does not matter: Electron, its helpers or the server can outlive it.
  const survivors = await stopPids([...shell.owned], ops);
  if (survivors.length > 0) throw new Error(`Could not stop the shell's own processes: pids ${survivors.join(', ')}`);
}

/**
 * Test cleanup. The shell's processes, any other pids (the stub hub) and the temp folder are separate steps: each runs
 * even when an earlier one throws, and the folder goes last so a locked file never leaves a process running.
 */
export async function teardownSmoke(
  targets: { shell?: ShellRecord; pids?: ReadonlyArray<number | undefined> },
  ops: TeardownOps = realOps,
): Promise<void> {
  const { shell, pids = [] } = targets;
  await runCleanups([
    () => (shell ? stopShellProcesses(shell, ops) : undefined),
    async () => {
      const survivors = await stopPids(
        pids.filter((pid): pid is number => pid !== undefined),
        ops,
      );
      if (survivors.length > 0) throw new Error(`Could not stop pids ${survivors.join(', ')}`);
    },
    () => (shell ? removeFolder(shell.root, ops) : undefined),
  ]);
}

/** Ends a shell and every process it owns (also when the launcher already exited), then removes its folder. */
export const stopShell = (shell: ShellRecord, ops: TeardownOps = realOps): Promise<void> =>
  teardownSmoke({ shell }, ops);
