import { afterEach, describe, expect, it, vi } from 'vitest';
import { stopAndReport, stopDiscarded } from '../../src/playback/discardStop.js';
import { DISCARD_GRACE_MS } from '../../src/playback/encoderProcess.js';
import { FakeEncoder } from './fakeEncoder.js';

afterEach(() => {
  vi.useRealTimers();
});

function target() {
  const info = vi.fn();
  const error = vi.fn();
  const cutEncoderInput = vi.fn();
  const event = vi.fn();
  return {
    info,
    error,
    event,
    cutEncoderInput,
    discard: {
      sessionId: 'session-1',
      reason: 'seek' as const,
      logger: { info, error },
      event,
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

  it('never reports a process that survived the kill as stopped: it logs an error and throws', async () => {
    vi.useFakeTimers();
    const { info, error, discard } = target();
    const proc = encoder();
    proc.surviveKill();

    const stopping = stopDiscarded(proc, discard);
    const rejected = expect(stopping).rejects.toMatchObject({ statusCode: 503, code: 'encoder_not_stopped' });
    await vi.advanceTimersByTimeAsync(DISCARD_GRACE_MS);
    await rejected;

    expect(proc.running).toBe(true);
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      { sessionId: 'session-1', reason: 'seek', elapsedMs: DISCARD_GRACE_MS },
      expect.any(String),
    );
  });

  it('records one error event for a stuck stop and one info event for its late exit, with session and reason only', async () => {
    vi.useFakeTimers();
    const { event, discard } = target();
    const proc = encoder();
    proc.surviveKill();

    for (let round = 0; round < 2; round += 1) {
      const stopping = stopDiscarded(proc, discard);
      const rejected = expect(stopping).rejects.toMatchObject({ code: 'encoder_not_stopped' });
      await vi.advanceTimersByTimeAsync(DISCARD_GRACE_MS);
      await rejected;
    }

    expect(event).toHaveBeenCalledTimes(1);
    expect(event).toHaveBeenCalledWith({
      level: 'error',
      source: 'ffmpeg',
      message: expect.any(String),
      details: { reason: 'seek', elapsedMs: DISCARD_GRACE_MS },
      sessionId: 'session-1',
    });

    proc.exitNow();
    await proc.exited;
    await vi.advanceTimersByTimeAsync(0);

    expect(event).toHaveBeenCalledTimes(2);
    expect(event).toHaveBeenLastCalledWith({
      level: 'info',
      source: 'ffmpeg',
      message: expect.any(String),
      details: { reason: 'seek' },
      sessionId: 'session-1',
    });
  });

  it('records no event for a stop that ends the process', async () => {
    vi.useFakeTimers();
    const { event, discard } = target();
    const proc = encoder();
    proc.ignoreQ();

    const stopping = stopDiscarded(proc, discard);
    await vi.advanceTimersByTimeAsync(DISCARD_GRACE_MS);
    await stopping;

    expect(event).not.toHaveBeenCalled();
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

describe('stopAndReport', () => {
  it('records one error event per reason and one info event at the late exit', async () => {
    vi.useFakeTimers();
    const { event, info, error } = target();
    const proc = encoder();
    proc.surviveKill();
    const kept = { sessionId: 'session-1', reason: 'park' as const, logger: { info, error }, event };

    for (let round = 0; round < 2; round += 1) {
      const stopping = stopAndReport(proc, kept);
      await vi.advanceTimersByTimeAsync(DISCARD_GRACE_MS * 10);
      await stopping;
    }

    expect(event).toHaveBeenCalledTimes(1);
    expect(event).toHaveBeenCalledWith({
      level: 'error',
      source: 'ffmpeg',
      message: expect.any(String),
      details: { reason: 'park', elapsedMs: expect.any(Number) },
      sessionId: 'session-1',
    });

    proc.exitNow();
    await proc.exited;
    await vi.advanceTimersByTimeAsync(0);

    expect(event).toHaveBeenCalledTimes(2);
    expect(event).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info', details: { reason: 'park' } }));
  });
});
