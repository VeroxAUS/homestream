/** What the smoke teardown needs from the machine; tests pass a fake so no real process is touched. */
export interface TeardownOps {
  isAlive(pid: number): boolean;
  /** A polite request to end (SIGTERM, taskkill without /F). May do nothing. */
  stop(pid: number): void;
  /** Ends the process and everything below it, by pid. */
  kill(pid: number): void;
  descendants(pid: number): number[];
  wait(ms: number): Promise<void>;
  removeDir(dir: string): void;
}

const GRACE_MS = 5000;
const KILL_WAIT_MS = 3000;
const POLL_MS = 250;

async function waitUntilGone(pids: readonly number[], ops: TeardownOps, budgetMs: number): Promise<number[]> {
  let alive = pids.filter((pid) => ops.isAlive(pid));
  for (let waited = 0; alive.length > 0 && waited < budgetMs; waited += POLL_MS) {
    await ops.wait(POLL_MS);
    alive = alive.filter((pid) => ops.isAlive(pid));
  }
  return alive;
}

const attempt = (action: () => void): void => {
  try {
    action();
  } catch {
    // The process may have exited between the check and the signal; the next alive check tells the truth.
  }
};

/** Gentle stop first, then a kill by pid for what is left. Never by name. Returns the pids that are still alive. */
export async function stopPids(pids: readonly number[], ops: TeardownOps): Promise<number[]> {
  const targets = [...new Set(pids)].filter((pid) => ops.isAlive(pid));
  if (targets.length === 0) return [];
  for (const pid of targets) attempt(() => ops.stop(pid));
  const stubborn = await waitUntilGone(targets, ops, GRACE_MS);
  for (const pid of stubborn) attempt(() => ops.kill(pid));
  return waitUntilGone(stubborn, ops, KILL_WAIT_MS);
}

/** Removing the temp folder is last and never fails a run: a locked file only leaves a throw-away folder behind. */
export function removeFolder(dir: string, ops: TeardownOps): void {
  try {
    ops.removeDir(dir);
  } catch (error) {
    console.warn(`Could not remove ${dir}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Runs every step even when an earlier one throws, then reports all failures together. */
export async function runCleanups(steps: ReadonlyArray<() => unknown>): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      errors.map((error) => (error instanceof Error ? error.message : String(error))).join('; '),
    );
  }
}
