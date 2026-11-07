import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../errors.js';
import { DISCARD_GRACE_MS, type EncoderHandle } from './encoderProcess.js';
import { recordStuckStop, type EventSink } from './stuckStop.js';

export type DiscardReason = 'seek' | 'tracks' | 'abandon';

const ENCODER_NOT_STOPPED = 'encoder_not_stopped';

export interface DiscardTarget {
  sessionId: string;
  reason: DiscardReason;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  event: EventSink;
  /** The session's source handle: its encoder input is cut first so ffmpeg is not blocked on a read. */
  source: { cutEncoderInput(): void };
}

/** Stops whose result nobody waits on a throw for: the memory watchdog's stop and the disk cap's park. */
type KeptStopReason = 'memory' | 'park';

export interface KeptStopTarget {
  sessionId: string;
  reason: KeptStopReason;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  event: EventSink;
}

/**
 * Stops an encoder whose session stays (a memory-limit failure, a park for the disk cap). The slot needs no extra hold: a
 * failed session with a running encoder and a live session both keep their place, and no launch happens while it runs.
 * A process that survives the retried kill is logged as an error once, never as stopped, and its late exit at info.
 */
export async function stopAndReport(proc: EncoderHandle | null | undefined, target: KeptStopTarget): Promise<void> {
  if (!proc?.running) return;
  const startedAt = Date.now();
  await proc.stop();
  if (!proc.running) return;
  const { sessionId, reason, logger } = target;
  const elapsedMs = Date.now() - startedAt;
  if (!recordStuckStop(proc, target.event, { sessionId, reason, elapsedMs })) return;
  logger.error(
    { sessionId, reason, elapsedMs },
    'Encoder is still running after the kill; its place stays taken until it exits',
  );
  void proc.exited.then(() => logger.info({ sessionId, reason }, 'Encoder that outlived its stop has exited'));
}

export function encoderNotStopped(): AppError {
  return new AppError(
    503,
    ENCODER_NOT_STOPPED,
    'The previous video encoder has not exited yet.',
    'Try again in a few seconds. The server waits for the old encoder before it starts a new one.',
  );
}

export function isEncoderNotStopped(error: unknown): boolean {
  return error instanceof AppError && error.code === ENCODER_NOT_STOPPED;
}

/**
 * Stops an encoder whose output is thrown away: cuts its input, sends `q` and kills the process tree only after
 * `DISCARD_GRACE_MS` without a clean exit. Resolves once the process has exited, so the next encoder (or the slot's
 * release) never overlaps it on the GPU. The way it ended is logged so force-kills can be counted.
 * A process that survives the retried kill is never reported as stopped: this logs an error and throws, and the caller
 * must start no replacement and keep the place taken until the exit arrives.
 */
export async function stopDiscarded(proc: EncoderHandle | null, target: DiscardTarget): Promise<void> {
  if (!proc?.running) return;
  const startedAt = Date.now();
  await proc.stop({ graceMs: DISCARD_GRACE_MS, cutInput: () => target.source.cutEncoderInput() });
  const elapsedMs = Date.now() - startedAt;
  if (proc.running) {
    recordStuckStop(proc, target.event, { sessionId: target.sessionId, reason: target.reason, elapsedMs });
    target.logger.error(
      { sessionId: target.sessionId, reason: target.reason, elapsedMs },
      'Discarded encoder is still running after the kill; its place stays taken until it exits',
    );
    throw encoderNotStopped();
  }
  const exit = await proc.exited;
  const outcome = exit.killed ? 'killed' : 'clean';
  target.logger.info(
    { sessionId: target.sessionId, reason: target.reason, outcome, elapsedMs },
    outcome === 'clean' ? 'Discarded encoder exited cleanly' : 'Discarded encoder was killed after the grace',
  );
}
