import type { NetworkSession } from '@homestream/shared';
import { leadSeconds } from '../network/readAhead.js';
import type { PlaybackContext } from './context.js';
import { encoderWarm, extractorLimit, isHeavySource, limitLabel, type LimitLabel } from './extractorSchedule.js';
import { SEGMENT_SECONDS } from './playlist.js';
import type { SessionRecord } from './session.js';

const LIMIT_LOG_WINDOW_MS = 120_000;
const SPEED_WINDOW_MS = 4_000;
const SPEED_WINDOW_MIN_MS = 1_500;

/**
 * How far ahead of the player the encoder is and how that shares the capped link: the source's read-ahead window, the
 * subtitle extractor's limit, the recent encoder speed and the falling-behind watch.
 */
export class ReadAheadPacing {
  private readonly limitLabels = new WeakMap<SessionRecord, LimitLabel>();
  private readonly speedWindows = new WeakMap<SessionRecord, Array<{ at: number; outSec: number }>>();

  constructor(private readonly ctx: PlaybackContext) {}

  /** A new encoder run starts counting its speed from scratch. */
  resetSpeed(rec: SessionRecord): void {
    this.speedWindows.delete(rec);
  }

  followPlayhead(rec: SessionRecord): void {
    rec.source.setPlayhead(rec.positionSec / rec.probe.durationSec);
    this.syncReadAhead(rec);
    this.updateStarved(rec);
  }

  /** How far the subtitle extractors may read: the player's position, including a segment it has just asked for after a seek. */
  reachSec(rec: SessionRecord): number {
    return Math.max(rec.positionSec, rec.playerSegment * SEGMENT_SECONDS);
  }

  syncReadAhead(rec: SessionRecord): void {
    rec.source.setLead(this.leadSec(rec));
    rec.subtitles?.syncHolds();
  }

  isHeavy(rec: SessionRecord): boolean {
    return isHeavySource({
      height: rec.probe.video.height,
      sizeBytes: rec.source.sizeBytes,
      durationSec: rec.probe.durationSec,
    });
  }

  /** Subtitle extraction must not compete with an encoder that has little lead over the player or runs slower than 1.2x. */
  updateStarved(rec: SessionRecord): void {
    const heavy = this.isHeavy(rec);
    const encoder = {
      done: rec.encoderDone,
      startSegment: rec.startSegment,
      headSegment: rec.stats.headSegment,
      playerSegment: rec.playerSegment,
      speed: rec.stats.speed,
      recentSpeed: this.recentSpeed(rec),
    };
    if (heavy && encoderWarm(encoder)) rec.subtitles?.noteEncoderWarm();
    const limit = extractorLimit({ heavy, bursting: rec.subtitles?.bursting ?? false, encoder });
    rec.source.setExtractorLimit(limit);
    const label = limitLabel(limit);
    if (this.limitLabels.get(rec) !== label) {
      this.limitLabels.set(rec, label);
      // The trail is for the start-up phase; later flapping would only add noise.
      if (Date.now() - rec.startedAt < LIMIT_LOG_WINDOW_MS)
        this.ctx.options.logger.info(
          {
            sessionId: rec.id,
            sinceStartMs: Date.now() - rec.startedAt,
            extractorLimit: label,
            headSegment: rec.stats.headSegment,
            startSegment: rec.startSegment,
            speed: Number(rec.stats.speed.toFixed(2)),
          },
          'Subtitle extractor read limit changed',
        );
    }
  }

  trackSpeed(rec: SessionRecord): void {
    const now = Date.now();
    const window = this.speedWindows.get(rec) ?? [];
    window.push({ at: now, outSec: rec.stats.outTimeSec });
    while (window.length > 2 && now - (window[1] as { at: number }).at >= SPEED_WINDOW_MS) window.shift();
    this.speedWindows.set(rec, window);
  }

  /** Per-session download figures for the health `network` check. */
  networkSessions(): NetworkSession[] {
    return this.ctx.slots.live().map((rec) => ({
      sessionId: rec.id,
      rateMbps: rec.source.rateMbps(),
      readAhead: rec.source.readAhead,
      leadSec: rec.source.leadSec,
    }));
  }

  /** Sessions whose encoder has been slower than real time for over 30 s while catching up; one waiting at its window never counts. */
  fallingBehindSessions(): string[] {
    this.observeSpeeds();
    return this.ctx.fallingBehind.fallingBehind(Date.now());
  }

  observeSpeeds(): void {
    const now = Date.now();
    for (const rec of this.ctx.slots.live()) {
      this.ctx.fallingBehind.observe(
        rec.id,
        {
          speed: this.recentSpeed(rec),
          readAhead: rec.source.readAhead,
          idle: rec.encoderDone || rec.parked || !rec.process?.running,
        },
        now,
      );
    }
  }

  /** Seconds of encoded video ahead of the player; the player's position cannot be before the start of the current run. */
  private leadSec(rec: SessionRecord): number {
    return leadSeconds(
      rec.stats.headSegment,
      SEGMENT_SECONDS,
      Math.max(rec.positionSec, rec.startSegment * SEGMENT_SECONDS),
    );
  }

  /** Encoder speed over the last few seconds; ffmpeg's own figure averages the whole run and reacts too late. 0 while unknown. */
  private recentSpeed(rec: SessionRecord): number {
    const window = this.speedWindows.get(rec);
    const first = window?.[0];
    const last = window?.at(-1);
    if (!first || !last || last.at - first.at < SPEED_WINDOW_MIN_MS) return 0;
    return (last.outSec - first.outSec) / ((last.at - first.at) / 1000);
  }
}
