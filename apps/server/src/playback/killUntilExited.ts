/** How long one kill gets before it counts as failed. */
export const KILL_WAIT_MS = 5000;
/** Kills sent to a process that does not exit before the caller is told it is still running. */
export const KILL_ATTEMPTS = 3;

export interface KillUntilExitedOptions {
  kill(): Promise<void>;
  exited: Promise<unknown>;
  isDone(): boolean;
  waitMs?: number;
  attempts?: number;
}

/** Sends the kill, waits for the exit, and repeats a bounded number of times. Resolves true once the process exited. */
export async function killUntilExited({
  kill,
  exited,
  isDone,
  waitMs = KILL_WAIT_MS,
  attempts = KILL_ATTEMPTS,
}: KillUntilExitedOptions): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await Promise.resolve()
      .then(kill)
      .catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs);
      timer.unref();
    });
    await Promise.race([exited, late]);
    clearTimeout(timer);
    if (isDone()) return true;
  }
  return isDone();
}
