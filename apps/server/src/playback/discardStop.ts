import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../errors.js';
import { DISCARD_GRACE_MS, type EncoderHandle } from './encoderProcess.js';

export type DiscardReason = 'seek' | 'tracks' | 'abandon';

const ENCODER_NOT_STOPPED = 'encoder_not_stopped';

export interface DiscardTarget {
  sessionId: string;
  reason: DiscardReason;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  /** The session's source handle: its encoder input is cut first so ffmpeg is not blocked on a read. */
  source: { cutEncoderInput(): void };
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
    target.logger.error(
      { sessionId: target.sessionId, reason: target.reason, elapsedMs },
      'Discarded encoder is still running after the kill; its place stays taken until it exits',
    );
    throw new AppError(
      503,
      ENCODER_NOT_STOPPED,
      'The previous video encoder has not exited yet.',
      'Try again in a few seconds. The server waits for the old encoder before it starts a new one.',
    );
  }
  const exit = await proc.exited;
  const outcome = exit.killed ? 'killed' : 'clean';
  target.logger.info(
    { sessionId: target.sessionId, reason: target.reason, outcome, elapsedMs },
    outcome === 'clean' ? 'Discarded encoder exited cleanly' : 'Discarded encoder was killed after the grace',
  );
}
