/** Leaves room for a stuck encoder's grace and kill (3 s + up to 5 s) and still ends within the 10 s a supervisor waits. */
export const SHUTDOWN_DEADLINE_MS = 8000;

export interface ShutdownOptions {
  /** Stops everything that needs a clean stop (discovery goodbye, sessions, server, log flush). */
  stop(): Promise<void>;
  exit(code: number): void;
  warn(message: string): void;
  deadlineMs?: number;
}

/** A stop that hangs on one step must not keep the server alive: the process exits once the deadline passes. */
export function createShutdown(options: ShutdownOptions): (reason: string) => Promise<void> {
  let stopping = false;
  return async (reason) => {
    if (stopping) return;
    stopping = true;
    const deadlineMs = options.deadlineMs ?? SHUTDOWN_DEADLINE_MS;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), deadlineMs);
    });
    const outcome = await Promise.race([options.stop().then(() => 'done' as const, () => 'done' as const), late]);
    clearTimeout(timer);
    if (outcome === 'late') options.warn(`Shutdown (${reason}) did not finish within ${Math.round(deadlineMs / 1000)} s; exiting anyway.`);
    options.exit(0);
  };
}
