import os from 'node:os';

/** Keeps ffmpeg/ffprobe from competing with the desktop and the server itself; failure to lower it is harmless. */
export function lowerPriority(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // the process already exited or access was denied
  }
}
