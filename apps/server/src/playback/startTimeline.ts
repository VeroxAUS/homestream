import type { FastifyBaseLogger } from 'fastify';

export type StartStep =
  | 'stream picked'
  | 'source acquired'
  | 'probe done'
  | 'head fill done'
  | 'extractor started'
  | 'encoder spawned'
  | 'first segment written';

/**
 * Debug log lines for the steps between a start request and the first segment, each with the milliseconds since the request
 * arrived. The message is fixed text and the fields are a step name, a session id and a number, so nothing sensitive can enter.
 */
export class StartTimeline {
  constructor(
    private readonly logger: Pick<FastifyBaseLogger, 'debug'>,
    private readonly requestAt: number = Date.now(),
  ) {}

  private readonly logged = new Set<StartStep>();

  /** A timeline for the next candidate stream of the same request: same clock, steps may be logged again. */
  nextAttempt(): StartTimeline {
    return new StartTimeline(this.logger, this.requestAt);
  }

  /** Logs the step; a step already logged for this attempt (an encoder or extractor retry) is skipped. */
  mark(step: StartStep, sessionId?: string): void {
    if (this.logged.has(step)) return;
    this.logged.add(step);
    this.logger.debug(
      { source: 'playback', step, sessionId, sinceStartMs: Date.now() - this.requestAt },
      `Start timing: ${step}`,
    );
  }
}
