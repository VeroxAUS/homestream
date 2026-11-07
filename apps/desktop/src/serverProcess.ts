import { spawn, type ChildProcess } from 'node:child_process';
import type { ServerLaunch } from './serverLaunch.js';

export interface ExitInfo {
  code: number | null;
  signal: string | null;
}

/** The spawned server as the supervisor sees it; tests replace it with a fake. */
export interface ServerChild {
  readonly pid: number | undefined;
  onExit(callback: (info: ExitInfo) => void): void;
  onOutput(callback: (line: string, stream: 'stdout' | 'stderr') => void): void;
  /** Asks for a clean stop: the server sends its mDNS goodbye and closes its sessions. */
  requestShutdown(): void;
  /** Ends the process tree at once. */
  forceKill(): void;
}

function lineReader(callback: (line: string) => void): (chunk: Buffer) => void {
  let rest = '';
  return (chunk) => {
    rest += chunk.toString('utf8');
    const lines = rest.split(/\r?\n/);
    rest = lines.pop() as string;
    for (const line of lines) if (line) callback(line);
  };
}

/** Starts the server with a piped stdin (for the `shutdown` line), no console window and no inherited handles. */
export function spawnServerChild(launch: ServerLaunch, platform: NodeJS.Platform = process.platform): ServerChild {
  const child: ChildProcess = spawn(launch.command, launch.args, {
    env: launch.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const exitCallbacks: Array<(info: ExitInfo) => void> = [];
  let exited = false;
  const finish = (info: ExitInfo): void => {
    if (exited) return;
    exited = true;
    for (const callback of exitCallbacks) callback(info);
  };
  child.once('exit', (code, signal) => finish({ code, signal }));
  child.once('error', () => finish({ code: null, signal: null }));
  child.stdin?.on('error', () => undefined);
  return {
    pid: child.pid,
    onExit: (callback) => exitCallbacks.push(callback),
    onOutput(callback) {
      child.stdout?.on(
        'data',
        lineReader((line) => callback(line, 'stdout')),
      );
      child.stderr?.on(
        'data',
        lineReader((line) => callback(line, 'stderr')),
      );
    },
    requestShutdown() {
      try {
        child.stdin?.write('shutdown\n');
      } catch {
        // the child is already gone
      }
    },
    forceKill() {
      if (exited || child.pid === undefined) return;
      if (platform === 'win32') {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on(
          'error',
          () => undefined,
        );
      } else {
        child.kill('SIGKILL');
      }
    },
  };
}
