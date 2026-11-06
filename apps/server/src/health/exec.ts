import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import path from 'node:path';

export interface CommandResult {
  /** Exit code; null when the process never ran or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not run at all (`ENOENT`, `EACCES`, ...) or hit the timeout (`timeout`). */
  failure?: string;
}

export type CommandRunner = (file: string, args: string[], options: { timeoutMs: number }) => Promise<CommandResult>;

export interface DiskSpace {
  freeBytes: number;
  totalBytes: number;
}

export type DiskProbe = (dir: string) => Promise<DiskSpace>;

export const runCommand: CommandRunner = (file, args, { timeoutMs }) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ code: 0, stdout, stderr });
        return;
      }
      const err = error as NodeJS.ErrnoException & { killed?: boolean };
      if (err.killed) resolve({ code: null, stdout, stderr, failure: 'timeout' });
      else if (typeof err.code === 'number') resolve({ code: err.code, stdout, stderr });
      else resolve({ code: null, stdout, stderr, failure: String(err.code ?? 'failed') });
    });
  });

/** Free and total bytes of the volume holding `dir`; climbs to the nearest existing parent when the folder is not created yet. */
export const diskSpace: DiskProbe = async (dir) => {
  let current = dir;
  for (;;) {
    try {
      const stats = await statfs(current);
      return { freeBytes: Number(stats.bavail) * Number(stats.bsize), totalBytes: Number(stats.blocks) * Number(stats.bsize) };
    } catch (error) {
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
};
