import type { FastifyBaseLogger } from 'fastify';
import { DISCARD_GRACE_MS, type EncoderHandle } from './encoderProcess.js';

export type DiscardReason = 'seek' | 'tracks' | 'abandon';

export interface DiscardTarget {
  sessionId: string;
  reason: DiscardReason;
  logger: Pick<FastifyBaseLogger, 'info'>;
  /** The session's source handle: its encoder input is cut first so ffmpeg is not blocked on a read. */
  source: { cutEncoderInput(): void };
}

/**
 * Stops an encoder whose output is thrown away: cuts its input, sends `q` and kills the process tree only after
 * `DISCARD_GRACE_MS` without a clean exit. Resolves once the process has exited, so the next encoder (or the slot's
 * release) never overlaps it on the GPU. The way it ended is logged so force-kills can be counted.
 */
export async function stopDiscarded(proc: EncoderHandle | null, target: DiscardTarget): Promise<void> {
  if (!proc?.running) return;
  const startedAt = Date.now();
  await proc.stop({ graceMs: DISCARD_GRACE_MS, cutInput: () => target.source.cutEncoderInput() });
  const exit = proc.running ? undefined : await proc.exited;
  const outcome = !exit || exit.killed ? 'killed' : 'clean';
  target.logger.info(
    { sessionId: target.sessionId, reason: target.reason, outcome, elapsedMs: Date.now() - startedAt },
    outcome === 'clean' ? 'Discarded encoder exited cleanly' : 'Discarded encoder was killed after the grace',
  );
}
