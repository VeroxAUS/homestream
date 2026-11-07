import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { finalizePlay } from '../db/plays.js';
import type { PlaybackContext } from './context.js';
import type { EncoderLifecycle } from './encoderLifecycle.js';
import { DISCARD_STOP } from './encoderProcess.js';
import { describeMemoryLimitHit, type MemoryLimitHit } from './memoryWatchdog.js';
import { toActivitySession, type SessionRecord } from './session.js';
import { endStats, scrub, subjectOf } from './support.js';

/** A segment further ahead of the encoder than this triggers a restart at the requested position. */
const SEEK_WINDOW_SEGMENTS = 5;

/** A finished segment that is gone from disk (evicted) can only come back through a restart. */
export function isLost(rec: SessionRecord, index: number): boolean {
  if (index < rec.startSegment || rec.parked) return true;
  return !!rec.process?.running && index < rec.stats.headSegment - 1;
}

function isDead(rec: SessionRecord): boolean {
  return rec.state === 'error' || rec.stopping;
}

/** Resolves when the signal aborts; never rejects. */
function stopped(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/** True when the running encoder will produce `index` soon: it is at or ahead of the run's start and not too far behind it. */
function encoderWillProduce(rec: SessionRecord, index: number): boolean {
  if (!rec.process?.running) return false;
  const head = rec.stats.headSegment;
  return index >= rec.startSegment && index >= head - 1 && index <= head + SEEK_WINDOW_SEGMENTS;
}

/** What happens when the encoder has to run again: after a failure, a seek, a track switch or a memory-limit stop. */
export class Recovery {
  constructor(
    private readonly ctx: PlaybackContext,
    private readonly encoder: EncoderLifecycle,
  ) {}

  /** First failure: re-resolve the CDN link (and fall back from libplacebo) and carry on. Second failure ends the session. */
  async recover(rec: SessionRecord, code: number | null, stderrTail: string): Promise<void> {
    if (rec.retried) {
      await this.fail(rec, code, stderrTail);
      return;
    }
    rec.retried = true;
    // The retry waits for the link refresh; as the session's restart it keeps seeks, track switches and HLS requests from
    // launching an encoder next to the one it is about to start.
    rec.restart = this.retry(rec, code, stderrTail).finally(() => {
      rec.restart = null;
    });
    await rec.restart;
  }

  private async retry(rec: SessionRecord, code: number | null, stderrTail: string): Promise<void> {
    const { options } = this.ctx;
    options.observer?.restarted('retry');
    this.ctx.event({
      level: 'warn',
      source: 'ffmpeg',
      message: `The video encoder stopped (code ${code ?? 'none'}); retrying once with a fresh stream link.`,
      details: { detail: scrub(stderrTail.split(/\r?\n/).filter(Boolean).at(-1) ?? '') },
      sessionId: rec.id,
    });
    if (rec.decision.toneMapped && rec.toneMapper === 'libplacebo' && !this.encoder.hasSegment(rec, rec.startSegment)) {
      rec.toneMapper = 'opencl';
      this.ctx.libplaceboBroken = true;
      options.logger.warn(
        { sessionId: rec.id },
        'libplacebo tone mapping failed to start; falling back to tonemap_opencl',
      );
    }
    // The proxy re-resolves expired links by itself; this covers the encoder failing for another reason with a stale link.
    // Stopping the session must not wait for a gateway lookup that can take a minute; the lookup is abandoned, not cancelled.
    await Promise.race([rec.source.refresh().catch(() => undefined), stopped(rec.stopController.signal)]);
    if (isDead(rec)) return;
    this.encoder.launch(rec, this.encoder.resumePoint(rec));
  }

  /**
   * An ffmpeg process of the session grew past the memory limit. The session ends with an error right away (the generation bump
   * keeps the encoder's exit handler from retrying) and every process of it is stopped gently; the caller already stops the offender.
   */
  onMemoryLimit(rec: SessionRecord, who: string, hit: MemoryLimitHit): void {
    if (rec.stopping || rec.state === 'error') return;
    const { options } = this.ctx;
    const { usedMb, limitMb, message } = describeMemoryLimitHit(who, hit);
    rec.state = 'error';
    rec.errorCode = 'encoder_memory_limit';
    rec.error = {
      message,
      hint: 'Playback ended. Try again, or switch subtitles off. If it keeps happening, check the ffmpeg tile on the health dashboard.',
    };
    rec.generation += 1;
    if (!rec.opening) options.observer?.failed(subjectOf(rec), { stage: 'running', code: 'encoder_memory_limit' });
    rec.source.setExtractorLimit(null);
    options.logger.error({ sessionId: rec.id, pid: hit.pid, usedMb, limitMb }, 'ffmpeg stopped by the memory watchdog');
    this.ctx.event({
      level: 'error',
      source: 'ffmpeg',
      message: rec.error.message,
      details: { code: 'encoder_memory_limit', pid: hit.pid, usedMb, limitMb, hint: rec.error.hint },
      sessionId: rec.id,
    });
    this.finalizeFailed(rec);
    void Promise.all([rec.process?.stop(), rec.subtitles?.stop()]).catch(() => undefined);
  }

  /** Output of the previous track selection is thrown away, including init.mp4 whose audio parameters may differ. */
  async reconfigure(rec: SessionRecord, segment: number): Promise<void> {
    const previous = rec.process;
    rec.generation += 1;
    this.ctx.options.observer?.restarted('tracks');
    await previous?.stop(DISCARD_STOP);
    if (rec.stopping) return;
    for (const name of await readdir(rec.dir).catch(() => [] as string[])) {
      if (/^seg-\d+\.(?:ts|m4s)$/.test(name) || name === 'init-ready.mp4') {
        await rm(path.join(rec.dir, name), { force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
      }
    }
    rec.store.forget(0);
    rec.retried = false;
    this.encoder.launch(rec, segment);
  }

  /** Makes sure an encoder will produce segment `index`, restarting it there when the request is a seek. */
  async ensureEncoder(rec: SessionRecord, index: number): Promise<void> {
    if (isDead(rec)) return;
    if (rec.restart) await rec.restart;
    if (isDead(rec) || encoderWillProduce(rec, index)) return;
    rec.restart = this.restartAt(rec, index).finally(() => {
      rec.restart = null;
    });
    await rec.restart;
  }

  private async restartAt(rec: SessionRecord, index: number): Promise<void> {
    const previous = rec.process;
    rec.generation += 1;
    this.ctx.options.observer?.restarted('seek');
    await previous?.stop(DISCARD_STOP);
    if (rec.stopping) return;
    rec.retried = false;
    this.encoder.launch(rec, index);
  }

  private async fail(rec: SessionRecord, code: number | null, stderrTail: string): Promise<void> {
    const { options } = this.ctx;
    const lastLine = scrub(stderrTail.split(/\r?\n/).filter(Boolean).at(-1) ?? '');
    rec.state = 'error';
    rec.error = {
      message: scrub(`The video encoder stopped unexpectedly (code ${code ?? 'none'}). ${lastLine}`.trim()),
      hint: 'Try again. If it keeps happening, check the ffmpeg and GPU tiles on the health dashboard.',
    };
    if (rec.opening) {
      // The start waiting on this session reports the failure (or tries the next stream); no client ever saw the session.
      // An explicit stream's final failure is recorded as an error by `SessionSlots.abandon`.
      options.logger.warn({ sessionId: rec.id, code, detail: lastLine }, 'ffmpeg failed before the first segment');
      this.ctx.event({
        level: 'warn',
        source: 'ffmpeg',
        message: rec.error.message,
        details: { code, detail: lastLine },
        sessionId: rec.id,
      });
      return;
    }
    options.observer?.failed(subjectOf(rec), { stage: 'running', code: rec.errorCode ?? 'encoder_failed' });
    options.logger.error({ sessionId: rec.id, code, detail: lastLine }, 'ffmpeg failed');
    this.ctx.event({
      level: 'error',
      source: 'ffmpeg',
      message: rec.error.message,
      details: { code, detail: lastLine, hint: rec.error.hint },
      sessionId: rec.id,
    });
    this.finalizeFailed(rec);
  }

  private finalizeFailed(rec: SessionRecord): void {
    const { options } = this.ctx;
    finalizePlay(options.db, rec.id, {
      endedAt: Date.now(),
      status: 'error',
      errorMessage: rec.error?.message,
      ...endStats(rec),
    });
    options.bus.emit('session.update', toActivitySession(rec));
  }
}
