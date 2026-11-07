import type { LogEventInput } from '../events/record.js';
import type { EncoderHandle } from './encoderProcess.js';

/** Where a stuck stop is written down besides the process log: the SQLite event log that `/api/logs` reads. */
export type EventSink = (input: LogEventInput) => void;

/** A process is reported once per reason: a refused seek repeats, and the disk cap parks a stuck encoder on every tick. */
const reported = new WeakMap<EncoderHandle, Set<string>>();

/**
 * Records, once per process and reason, that a stop did not remove the process (an error event) and, when it finally
 * exits, that it did (an info event). The events carry the session and the reason only, never a pid, path or URL.
 * Returns false when this reason was reported before.
 */
export function recordStuckStop(
  proc: EncoderHandle,
  event: EventSink,
  report: { sessionId: string; reason: string; elapsedMs: number },
): boolean {
  const seen = reported.get(proc) ?? new Set<string>();
  reported.set(proc, seen);
  if (seen.has(report.reason)) return false;
  seen.add(report.reason);
  const { sessionId, reason, elapsedMs } = report;
  event({
    level: 'error',
    source: 'ffmpeg',
    message: 'A video encoder is still running after the kill; its place stays taken until it exits.',
    details: { reason, elapsedMs },
    sessionId,
  });
  void proc.exited.then(() =>
    event({
      level: 'info',
      source: 'ffmpeg',
      message: 'A video encoder that outlived its stop has exited; its place is free.',
      details: { reason },
      sessionId,
    }),
  );
  return true;
}
