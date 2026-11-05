import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface PidEntry {
  pid: number;
  sessionId: string;
  startedAt: number;
  /** Text the process command line must contain for the pid to be treated as ours; defaults to the session id. */
  match?: string;
}

export const PID_FILE_NAME = 'ffmpeg-pids.json';

/** Which ffmpeg processes this server started, so a crashed server's orphans can be found on the next start. */
export class PidRegistry {
  private entries: PidEntry[];

  constructor(readonly file: string) {
    this.entries = readEntries(file);
  }

  add(entry: PidEntry): void {
    this.entries = [...this.entries.filter((item) => item.pid !== entry.pid), entry];
    this.save();
  }

  remove(pid: number): void {
    const next = this.entries.filter((item) => item.pid !== pid);
    if (next.length === this.entries.length) return;
    this.entries = next;
    this.save();
  }

  list(): PidEntry[] {
    return [...this.entries];
  }

  private save(): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      writeFileSync(temp, JSON.stringify({ pids: this.entries }));
      renameSync(temp, this.file);
    } catch {
      // The registry is a best-effort safety net; playback must not fail because of it.
    }
  }
}

function readEntries(file: string): PidEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { pids?: unknown };
    if (!Array.isArray(parsed.pids)) return [];
    return parsed.pids.filter(
      (item): item is PidEntry =>
        !!item && typeof item === 'object' && Number.isInteger((item as PidEntry).pid) && typeof (item as PidEntry).sessionId === 'string',
    );
  } catch {
    return [];
  }
}

function execText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }, (_error, stdout) => resolve(stdout ?? ''));
  });
}

/** Command line per live pid; pids that are gone are absent. */
export async function commandLines(pids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (pids.length === 0) return result;
  if (process.platform === 'win32') {
    const filter = pids.map((pid) => `ProcessId=${pid}`).join(' OR ');
    const script = `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`;
    const out = await execText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    for (const line of out.split(/\r?\n/)) {
      const bar = line.indexOf('|');
      if (bar > 0) result.set(Number(line.slice(0, bar)), line.slice(bar + 1));
    }
    return result;
  }
  for (const pid of pids) {
    const line = (await execText('ps', ['-p', String(pid), '-o', 'args='])).trim();
    if (line) result.set(pid, line);
  }
  return result;
}

function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
      resolve();
      return;
    }
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

export interface OrphanCleanupResult {
  killed: number[];
  wipedDirs: string[];
}

/**
 * Kills ffmpeg processes recorded by a previous server run and wipes leftover session directories.
 * A pid is only killed when its command line still contains the recorded session id, so a recycled pid is left alone.
 */
export async function cleanupOrphans(registry: PidRegistry, transcodeDir: string): Promise<OrphanCleanupResult> {
  const recorded = registry.list();
  const lines = await commandLines(recorded.map((entry) => entry.pid));
  const killed: number[] = [];
  for (const entry of recorded) {
    const line = lines.get(entry.pid);
    if (line?.toLowerCase().includes((entry.match ?? entry.sessionId).toLowerCase())) {
      await killTree(entry.pid);
      killed.push(entry.pid);
    }
    registry.remove(entry.pid);
  }

  const wipedDirs: string[] = [];
  if (existsSync(transcodeDir)) {
    for (const entry of readdirSync(transcodeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(transcodeDir, entry.name);
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
        wipedDirs.push(dir);
      } catch {
        // A directory still locked by a dying process is retried on the next start.
      }
    }
  }
  return { killed, wipedDirs };
}
