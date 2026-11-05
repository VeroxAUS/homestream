import { afterAll, afterEach } from 'vitest';
import { killChildProcesses } from './gpuCleanup.js';

// A failed or timed out test may leave its session encoder running; stop it before the next test starts.
afterEach((context) => {
  if (context.task.result?.state === 'fail') killChildProcesses();
});

afterAll(() => {
  killChildProcesses();
});

// Last resort when the worker is torn down (timeout, crash of the runner) before the hooks above run.
process.once('exit', () => {
  killChildProcesses();
});
