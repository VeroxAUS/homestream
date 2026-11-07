import { afterEach, describe, expect, it, vi } from 'vitest';
import { KILL_ATTEMPTS, KILL_WAIT_MS, killUntilExited } from '../../src/playback/killUntilExited.js';

afterEach(() => {
  vi.useRealTimers();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('killUntilExited', () => {
  it('kills once and returns true when the exit arrives within the wait', async () => {
    vi.useFakeTimers();
    const exited = deferred();
    let done = false;
    const kill = vi.fn(() => Promise.resolve());

    const result = killUntilExited({ kill, exited: exited.promise, isDone: () => done });
    await vi.advanceTimersByTimeAsync(KILL_WAIT_MS - 1);
    done = true;
    exited.resolve();

    expect(await result).toBe(true);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('retries the kill a bounded number of times and returns false for a process that never exits', async () => {
    vi.useFakeTimers();
    const kill = vi.fn(() => Promise.resolve());

    const result = killUntilExited({ kill, exited: new Promise(() => undefined), isDone: () => false });
    await vi.advanceTimersByTimeAsync(KILL_WAIT_MS * KILL_ATTEMPTS);

    expect(await result).toBe(false);
    expect(kill).toHaveBeenCalledTimes(KILL_ATTEMPTS);
  });

  it('stops retrying as soon as a later kill works', async () => {
    vi.useFakeTimers();
    const exited = deferred();
    let done = false;
    const kill = vi.fn(() => {
      if (kill.mock.calls.length === 2) {
        done = true;
        exited.resolve();
      }
      return Promise.resolve();
    });

    const result = killUntilExited({ kill, exited: exited.promise, isDone: () => done });
    await vi.advanceTimersByTimeAsync(KILL_WAIT_MS * 2);

    expect(await result).toBe(true);
    expect(kill).toHaveBeenCalledTimes(2);
  });

  it('survives a kill that rejects', async () => {
    vi.useFakeTimers();
    const kill = vi.fn(() => Promise.reject(new Error('taskkill failed')));

    const result = killUntilExited({ kill, exited: new Promise(() => undefined), isDone: () => false });
    await vi.advanceTimersByTimeAsync(KILL_WAIT_MS * KILL_ATTEMPTS);

    expect(await result).toBe(false);
    expect(kill).toHaveBeenCalledTimes(KILL_ATTEMPTS);
  });
});
