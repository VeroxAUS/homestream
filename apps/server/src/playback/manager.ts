import type {
  ActivitySession,
  DownloadStartedResponse,
  NetworkSession,
  ProgressResponse,
  SessionPatchRequest,
  SessionResponse,
  SessionStartRequest,
} from '@homestream/shared';
import { updatePlayDecision, updatePlayProgress } from '../db/plays.js';
import { upsertProgress } from '../db/progress.js';
import { AppError } from '../errors.js';
import { clampPosition, isCompleted, isResumable, playingSecondsSince } from '../progress/rules.js';
import { PlaybackContext } from './context.js';
import { decide } from './decision.js';
import { EncoderLifecycle } from './encoderLifecycle.js';
import { HlsServing } from './hlsServing.js';
import { cleanupOrphans } from './pidRegistry.js';
import { SEGMENT_SECONDS, segmentCount, type HlsFile } from './playlist.js';
import { ReadAheadPacing } from './readAheadPacing.js';
import { Recovery } from './recovery.js';
import { toActivitySession, toSessionResponse, type SessionRecord } from './session.js';
import { SessionMonitor } from './monitor.js';
import { SessionStarter } from './sessionStart.js';
import { SubtitleHandoff } from './subtitleHandoff.js';
import { notFound, type PingUpdate, type PlaybackManagerOptions, type ServedFile } from './support.js';
import { planPatch } from './tracks.js';

export { MAX_SESSIONS } from './sessionSlots.js';
export type { PingUpdate, PlaybackManagerOptions, ServedFile } from './support.js';

const IDLE_TIMEOUT_MS = 120_000;
const MONITOR_TICK_MS = 2_000;
const GIB = 1024 ** 3;

/**
 * The playback facade: sessions, encoders, HLS files and subtitles for the routes. The work is split over focused modules
 * that share one `PlaybackContext`: session slots (`sessionSlots`), encoder lifecycle (`encoderLifecycle`), recovery and
 * seek (`recovery`), subtitle hand-off (`subtitleHandoff`), the start flow (`sessionStart`) and HLS serving (`hlsServing`).
 */
export class PlaybackManager {
  private readonly ctx: PlaybackContext;
  private readonly pacing: ReadAheadPacing;
  private readonly encoder: EncoderLifecycle;
  private readonly recovery: Recovery;
  private readonly subtitles: SubtitleHandoff;
  private readonly starter: SessionStarter;
  private readonly hls: HlsServing;
  private readonly monitor: SessionMonitor;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: PlaybackManagerOptions) {
    const ctx = new PlaybackContext(options);
    const { slots } = ctx;
    this.ctx = ctx;
    this.pacing = new ReadAheadPacing(ctx);
    this.encoder = new EncoderLifecycle(ctx, this.pacing, {
      failed: (rec, code, stderrTail) => void this.recovery.recover(rec, code, stderrTail),
      memoryLimit: (rec, who, hit) => this.recovery.onMemoryLimit(rec, who, hit),
    });
    this.recovery = new Recovery(ctx, this.encoder);
    this.subtitles = new SubtitleHandoff(ctx, this.pacing, (rec, who, hit) =>
      this.recovery.onMemoryLimit(rec, who, hit),
    );
    this.starter = new SessionStarter(ctx, this.encoder, this.subtitles, { sessionAdded: () => this.ensureTimer() });
    this.hls = new HlsServing(ctx, this.encoder, this.recovery, this.pacing);
    this.monitor = new SessionMonitor(
      {
        liveSessions: () => slots.live(),
        allSessions: () => slots.all().filter((rec) => !rec.stopping && !rec.opening),
        stopIdle: (rec) => slots.stopIdle(rec),
        stopForDisk: (rec) => slots.stopForDisk(rec),
        park: (rec) => this.encoder.park(rec),
        resume: (rec) => this.encoder.resume(rec),
        publish: (rec) => options.bus.emit('session.update', toActivitySession(rec)),
      },
      { idleTimeoutMs: options.idleTimeoutMs ?? IDLE_TIMEOUT_MS, capBytes: options.config.transcodeMaxGb * GIB },
    );
  }

  /** Kills ffmpeg processes left by a crashed server run and wipes stale session directories. Call once at server start. */
  async recoverOrphans(): Promise<void> {
    const { killed, wipedDirs } = await cleanupOrphans(this.ctx.registry, this.options.config.transcodeDir);
    if (killed.length > 0 || wipedDirs.length > 0) {
      this.ctx.event({
        level: 'warn',
        source: 'session',
        message: `Cleaned up after an unclean shutdown: stopped ${killed.length} leftover ffmpeg process(es), removed ${wipedDirs.length} stale session folder(s).`,
        details: { killedPids: killed },
      });
    }
  }

  /** Resolves to a session (201) or, for a title TorBox has to cache first, to the tracked download (202). */
  start(body: SessionStartRequest, clientIp: string | null): Promise<SessionResponse | DownloadStartedResponse> {
    return this.starter.start(body, clientIp);
  }

  get(id: string): SessionResponse {
    return toSessionResponse(this.ctx.slots.require(id));
  }

  has(id: string): boolean {
    return this.ctx.slots.has(id);
  }

  list(): SessionResponse[] {
    return this.ctx.slots
      .all()
      .filter((rec) => !rec.opening)
      .map(toSessionResponse);
  }

  /** Sessions that are being played or prepared; a failed encode is no longer live. */
  activity(): ActivitySession[] {
    return this.ctx.slots
      .live()
      .sort((a, b) => a.startedAt - b.startedAt)
      .map(toActivitySession);
  }

  /** Total finished-segment bytes across live sessions and the configured cap. */
  diskUsage(): { bytes: number; capBytes: number } {
    let bytes = 0;
    for (const rec of this.ctx.slots.all()) bytes += rec.store.totalBytes;
    return { bytes, capBytes: this.options.config.transcodeMaxGb * GIB };
  }

  /** Per-session download figures for the health `network` check. */
  networkSessions(): NetworkSession[] {
    return this.pacing.networkSessions();
  }

  /** Sessions whose encoder has been slower than real time for over 30 s while catching up; one waiting at its window never counts. */
  fallingBehindSessions(): string[] {
    return this.pacing.fallingBehindSessions();
  }

  /** Marks client activity that is not an HLS request (progress pings, subtitle fetches). */
  touch(id: string): void {
    this.ctx.slots.require(id).lastActivity = Date.now();
  }

  /**
   * Records a progress ping: counts as activity, updates the reported position and the playing/paused/buffering state, adds the
   * playing time since the previous ping to the play record and saves the resume position.
   */
  ping(id: string, update: PingUpdate): ProgressResponse {
    const rec = this.ctx.slots.require(id);
    const now = Date.now();
    rec.lastActivity = now;
    rec.pingedAt = now;
    rec.positionSec = Math.max(0, update.positionSec);
    rec.playerSegment = Math.floor(rec.positionSec / SEGMENT_SECONDS);
    this.pacing.followPlayhead(rec);
    const state = update.state ?? 'playing';
    if (rec.state === 'ready' || rec.state === 'playing' || rec.state === 'paused' || rec.state === 'buffering')
      rec.state = state;

    rec.watchedSec += playingSecondsSince(rec.pingState, now - rec.pingClock);
    rec.pingClock = now;
    rec.pingState = state;
    return this.saveProgress(rec, now);
  }

  /**
   * Switches the audio track and/or the subtitle choice. A new audio track or a changed burn-in restarts the one ffmpeg of the
   * session at the player's position; the playlist URL and segment names stay the same, so the client only reloads the player.
   * Choosing a text subtitle only records the choice: the WebVTT file is shown by the player.
   */
  async patch(id: string, body: SessionPatchRequest): Promise<SessionResponse> {
    const rec = this.ctx.slots.require(id);
    while (rec.restart) await rec.restart.catch(() => undefined);
    if (rec.stopping) throw notFound('This session has ended.');
    if (rec.state === 'error') {
      throw new AppError(
        409,
        'session_failed',
        'This playback session has failed and cannot switch tracks.',
        'Start a new playback session.',
      );
    }

    const plan = planPatch(rec.probe, { audioIndex: rec.selectedAudioIndex, subtitle: rec.selectedSubtitle }, body);
    rec.lastActivity = Date.now();
    rec.selectedSubtitle = plan.subtitle;
    if (body.subtitle !== undefined) rec.subtitleDefault = null;
    if (!plan.restart) return toSessionResponse(rec);

    rec.selectedAudioIndex = plan.audio?.index ?? null;
    rec.decision = decide({
      video: rec.probe.video,
      audio: plan.audio,
      device: rec.device,
      subtitleBurnIn: plan.subtitle?.mode === 'burn',
    });
    updatePlayDecision(this.options.db, rec.id, rec.decision);
    const segment = Math.min(segmentCount(rec.probe.durationSec) - 1, Math.floor(rec.positionSec / SEGMENT_SECONDS));
    this.ctx.event({
      level: 'info',
      source: 'session',
      message: `Playback tracks changed (audio ${plan.audio?.index ?? 'none'}, subtitles ${plan.subtitle ? `${plan.subtitle.mode} ${plan.subtitle.index}` : 'off'}); restarting the encoder at segment ${segment}.`,
      sessionId: rec.id,
    });
    rec.restart = this.recovery.reconfigure(rec, segment).finally(() => {
      rec.restart = null;
    });
    await rec.restart;
    return toSessionResponse(rec);
  }

  serve(id: string, file: HlsFile): Promise<ServedFile> {
    return this.hls.serve(id, file);
  }

  serveSubtitlePlaylist(id: string, index: number): ServedFile {
    return this.subtitles.playlist(id, index);
  }

  serveSubtitleSegment(id: string, index: number, segment: number, signal?: AbortSignal): Promise<ServedFile> {
    return this.subtitles.segment(id, index, segment, signal);
  }

  serveSubtitleFull(id: string, index: number): ServedFile {
    return this.subtitles.full(id, index);
  }

  async monitorTick(): Promise<void> {
    this.pacing.observeSpeeds();
    await this.monitor.tick();
  }

  async stop(id: string): Promise<void> {
    await this.ctx.slots.end(this.ctx.slots.require(id), 'stopped');
  }

  async stopAll(): Promise<void> {
    await this.ctx.slots.stopAll();
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.stopAll();
    this.ctx.watchdog.close();
  }

  private ensureTimer(): void {
    const interval = this.options.monitorTickMs ?? MONITOR_TICK_MS;
    if (this.timer || interval <= 0) return;
    this.timer = setInterval(() => {
      this.pacing.observeSpeeds();
      void this.monitor
        .tick()
        .catch((error: unknown) => this.options.logger.warn({ err: error }, 'Session housekeeping failed'));
    }, interval);
    this.timer.unref();
  }

  private saveProgress(rec: SessionRecord, now: number): ProgressResponse {
    const { db } = this.options;
    const { meta } = rec;
    const durationSec = rec.probe.durationSec;
    const positionSec = clampPosition(rec.positionSec, durationSec);
    const completed = isCompleted(positionSec, durationSec);
    db.exec('BEGIN');
    try {
      upsertProgress(db, {
        mediaKey: meta.mediaKey,
        tmdbId: meta.tmdbId,
        type: meta.mediaType,
        season: meta.season,
        episode: meta.episode,
        positionSec,
        durationSec,
        updatedAt: now,
        completed,
        meta: {
          title: meta.showTitle ?? meta.title,
          showTitle: meta.showTitle,
          episodeTitle: meta.showTitle ? meta.title : null,
          posterUrl: meta.posterUrl,
          backdropUrl: meta.backdropUrl,
        },
      });
      updatePlayProgress(db, rec.id, {
        watchedSec: rec.watchedSec,
        lastPositionSec: positionSec,
        completed,
        bytesServed: rec.bytesServed,
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return {
      mediaKey: meta.mediaKey,
      positionSec,
      durationSec,
      completed,
      resumable: isResumable(positionSec, completed),
    };
  }
}
