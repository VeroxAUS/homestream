import { finalizePlay, deletePlay } from '../db/plays.js';
import { AppError } from '../errors.js';
import type { LogEventInput } from '../events/record.js';
import { stopDiscarded } from './discardStop.js';
import type { FallingBehindWatch } from './fallingBehind.js';
import { toActivitySession, type SessionRecord } from './session.js';
import { endStats, notFound, scrub, subjectOf, type PlaybackManagerOptions, type StopReason } from './support.js';

/** Two streams at a time keeps the GPU to at most two encoders (AGENTS.md GPU safety rule 1). */
export const MAX_SESSIONS = 2;

/** What the slots need from the shared playback context. */
export interface SlotHost {
  readonly options: PlaybackManagerOptions;
  readonly fallingBehind: FallingBehindWatch;
  event(input: LogEventInput): void;
  removeDir(dir: string): Promise<void>;
}

/** The sessions a manager holds and the places left for new ones: reserve, release and drain. */
export class SessionSlots {
  private readonly sessions = new Map<string, SessionRecord>();
  private starting = 0;
  /** Ended sessions whose encoder has not exited yet: the GPU still runs it, so its place stays taken. */
  private draining = 0;

  constructor(
    private readonly host: SlotHost,
    private readonly maxSessions: number,
  ) {}

  /** Takes a place for a start that is under way; pair it with `endReservation()`. */
  reserve(): void {
    if (this.live().length + this.failedButRunning() + this.starting + this.draining >= this.maxSessions) {
      throw new AppError(
        429,
        'too_many_sessions',
        'Two streams are already playing. Stop one to start another.',
        'Stop playback on another device, or wait a couple of minutes for idle sessions to time out, then try again.',
      );
    }
    this.starting += 1;
  }

  endReservation(): void {
    this.starting -= 1;
  }

  add(rec: SessionRecord): void {
    this.sessions.set(rec.id, rec);
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  require(id: string): SessionRecord {
    const rec = this.sessions.get(id);
    if (!rec) throw notFound(`Session ${id.slice(0, 64)} was not found.`);
    return rec;
  }

  /** Every session record, including failed ones that still await cleanup and ones still opening. */
  all(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  /** Sessions the clients know about and that are not failed; one still opening is counted by `starting` instead. */
  live(): SessionRecord[] {
    return this.all().filter((rec) => rec.state !== 'error' && !rec.stopping && !rec.opening);
  }

  /** A failed session is not live, but the encoder the memory watchdog stopped may still be exiting. */
  private failedButRunning(): number {
    return this.all().filter((rec) => rec.state === 'error' && !rec.stopping && !rec.opening && rec.process?.running)
      .length;
  }

  async stopIdle(rec: SessionRecord): Promise<void> {
    this.host.event({
      level: 'info',
      source: 'session',
      message: `Playback stopped after ${Math.round((Date.now() - rec.lastActivity) / 1000)} s without activity.`,
      sessionId: rec.id,
    });
    await this.end(rec, 'idle');
  }

  async stopForDisk(rec: SessionRecord): Promise<void> {
    this.host.event({
      level: 'warn',
      source: 'session',
      message: 'An idle playback session was stopped to stay within the transcode disk limit.',
      sessionId: rec.id,
    });
    await this.end(rec, 'disk');
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.all().map((rec) => this.end(rec, 'shutdown')));
  }

  async end(rec: SessionRecord, reason: StopReason): Promise<void> {
    if (rec.stopping) return;
    const { options } = this.host;
    rec.stopping = true;
    rec.stopController.abort();
    const wasError = rec.state === 'error';
    rec.state = 'stopped';
    this.sessions.delete(rec.id);
    this.host.fallingBehind.forget(rec.id);
    this.draining += 1;
    try {
      await rec.restart?.catch(() => undefined);
      await Promise.all([rec.process?.stop(), rec.subtitles?.stop()]);
    } finally {
      this.draining -= 1;
    }
    rec.source.release();
    await this.host.removeDir(rec.dir);
    if (!wasError) finalizePlay(options.db, rec.id, { endedAt: Date.now(), status: 'ok', ...endStats(rec) });
    options.logger.info({ sessionId: rec.id, reason }, 'Playback session stopped');
    options.observer?.ended(subjectOf(rec), {
      reason,
      watchedSec: rec.watchedSec,
      avgSpeed: endStats(rec).avgSpeed,
    });
    options.bus.emit('session.end', { sessionId: rec.id, reason, state: 'stopped' });
  }

  /**
   * Throws away a session that never reached its first segment: nothing of it may remain. A start that fails for good
   * (`failure`, an explicit stream gets no fallback) keeps an error play record and is logged and announced instead.
   */
  async abandon(rec: SessionRecord, failure?: AppError): Promise<void> {
    if (rec.stopping) return;
    rec.stopping = true;
    rec.stopController.abort();
    rec.state = 'stopped';
    // A new generation keeps the exit handler of the stopped encoder from retrying it.
    rec.generation += 1;
    this.sessions.delete(rec.id);
    this.host.fallingBehind.forget(rec.id);
    await rec.restart?.catch(() => undefined);
    await Promise.all([
      stopDiscarded(rec.process, {
        sessionId: rec.id,
        reason: 'abandon',
        logger: this.host.options.logger,
        source: rec.source,
      }),
      rec.subtitles?.stop(),
    ]);
    rec.source.release();
    await this.host.removeDir(rec.dir);
    if (failure) this.recordStartFailure(rec, failure);
    else deletePlay(this.host.options.db, rec.id);
  }

  private recordStartFailure(rec: SessionRecord, failure: AppError): void {
    const { options } = this.host;
    rec.state = 'error';
    rec.error ??= { message: scrub(failure.message), hint: failure.hint };
    options.logger.error({ sessionId: rec.id, code: failure.code }, 'Playback start failed');
    this.host.event({
      level: 'error',
      source: 'ffmpeg',
      message: rec.error.message,
      details: { code: failure.code, hint: rec.error.hint },
      sessionId: rec.id,
    });
    finalizePlay(options.db, rec.id, {
      endedAt: Date.now(),
      status: 'error',
      errorMessage: rec.error.message,
      ...endStats(rec),
    });
    options.bus.emit('session.update', toActivitySession(rec));
  }
}
