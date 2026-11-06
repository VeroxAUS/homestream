import { execFileSync } from 'node:child_process';

const GPU_PROCESS_NAMES = ['ffmpeg.exe', 'ffprobe.exe'];

/** Pids of direct children of `parentPid` whose image name is in `names`. */
function listChildPids(names: string[], parentPid: number = process.pid): number[] {
  if (process.platform !== 'win32') return [];
  const clause = names.map((name) => `Name='${name}'`).join(' OR ');
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid} AND (${clause})" | ForEach-Object { $_.ProcessId }`,
    ],
    { encoding: 'utf8', timeout: 20_000, windowsHide: true },
  );
  return out
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/**
 * Kills (with their process trees) the matching processes this test worker started itself. The app runs in-process,
 * so session encoders and extractors are direct children of the worker. Never touches anyone else's processes.
 */
export function killChildProcesses(names: string[] = GPU_PROCESS_NAMES, parentPid: number = process.pid): number[] {
  let pids: number[];
  try {
    pids = listChildPids(names, parentPid);
  } catch {
    return [];
  }
  for (const pid of pids) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 10_000,
        windowsHide: true,
      });
    } catch {
      // already gone
    }
  }
  return pids;
}
