import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHUTDOWN_DEADLINE_MS, createShutdown } from '../src/shutdown.js';

describe('createShutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exits as soon as the stop finishes', async () => {
    const exit = vi.fn();
    const warn = vi.fn();
    await createShutdown({ stop: () => Promise.resolve(), exit, warn })('test');
    expect(exit).toHaveBeenCalledWith(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('exits anyway, with a warning, when a step never finishes', async () => {
    const exit = vi.fn();
    const warn = vi.fn();
    const done = createShutdown({ stop: () => new Promise<void>(() => undefined), exit, warn })('stdin');
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stdin'));
    expect(SHUTDOWN_DEADLINE_MS).toBeLessThan(10_000);
  });

  it('exits when the stop throws, and runs the stop only once', async () => {
    const exit = vi.fn();
    const stop = vi.fn(() => Promise.reject(new Error('boom')));
    const shutdown = createShutdown({ stop, exit, warn: vi.fn() });
    await Promise.all([shutdown('a'), shutdown('b')]);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
