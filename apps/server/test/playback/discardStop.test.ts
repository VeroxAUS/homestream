import { afterEach, describe, expect, it, vi } from 'vitest';
import { stopDiscarded } from '../../src/playback/discardStop.js';
import { DISCARD_GRACE_MS } from '../../src/playback/encoderProcess.js';
import { FakeEncoder } from './fakeEncoder.js';

afterEach(() => {
  vi.useRealTimers();
});

function target() {
  const info = vi.fn();
  const cutEncoderInput = vi.fn();
  return {
    info,
    cutEncoderInput,
    discard: {
      sessionId: 'session-1',
      reason: 'seek' as const,
      logger: { info },
      source: { cutEncoderInput },
    },
  };
}

const encoder = () => new FakeEncoder('hang', { cwd: '.', args: [] } as never);

describe('stopDiscarded', () => {
  it('cuts the input, sends q, and logs a clean exit with the elapsed time', async () => {
    vi.useFakeTimers();
    const { info, cutEncoderInput, discard } = target();
    const proc = encoder();
    const release = proc.holdStop();

    const stopping = stopDiscarded(proc, discard);
    await vi.advanceTimersByTimeAsync(300);
    release();
    await stopping;

    expect(proc.stopCalls).toEqual([{ graceMs: DISCARD_GRACE_MS, cutInput: expect.any(Function) }]);
    expect(proc.order).toEqual(['cut', 'q']);
    expect(cutEncoderInput).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      { sessionId: 'session-1', reason: 'seek', outcome: 'clean', elapsedMs: 300 },
      expect.any(String),
    );
  });

  it('logs a kill once the grace passed without a clean exit', async () => {
    vi.useFakeTimers();
    const { info, discard } = target();
    const proc = encoder();
    proc.ignoreQ();

    const stopping = stopDiscarded(proc, discard);
    await vi.advanceTimersByTimeAsync(DISCARD_GRACE_MS - 1);
    expect(proc.running).toBe(true);
    expect(info).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await stopping;

    expect(proc.order).toEqual(['cut', 'q', 'kill']);
    expect(info).toHaveBeenCalledWith(
      { sessionId: 'session-1', reason: 'seek', outcome: 'killed', elapsedMs: DISCARD_GRACE_MS },
      expect.any(String),
    );
  });

  it('does nothing and logs nothing when there is no running encoder', async () => {
    const { info, cutEncoderInput, discard } = target();
    const exited = encoder();
    await exited.stop();

    await stopDiscarded(null, discard);
    await stopDiscarded(exited, discard);

    expect(cutEncoderInput).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });
});
