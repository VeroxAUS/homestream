import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type {
  ActivitySession,
  CapabilityProfile,
  MovieDetails,
  NetworkSession,
  PingState,
  ProgressResponse,
  ShowDetails,
  SessionPatchRequest,
  SessionResponse,
  SessionStartRequest,
  StartAttempt,
} from '@homestream/shared';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { upsertDevice } from '../db/devices.js';
import { deletePlay, finalizePlay, insertPlay, mediaKeyFor, updatePlayDecision, updatePlayProgress } from '../db/plays.js';
import { upsertProgress } from '../db/progress.js';
import { AllStreamsFailedError, AppError } from '../errors.js';
import type { EventBus } from '../events/bus.js';
import { logEvent, type LogEventInput } from '../events/record.js';
import { leadSeconds } from '../network/readAhead.js';
import { clampPosition, isCompleted, isResumable, playingSecondsSince } from '../progress/rules.js';
import { redact } from '../redact.js';
import type { SourceHandle, SourceProxy } from '../sourceproxy/proxy.js';
import { deviceMaxRank, startCandidates } from '../streams/rank.js';
import type { ResolvedStream, StreamService } from '../streams/service.js';
import type { TmdbService } from '../tmdb/service.js';
import { chooseDefaultSubtitle } from './defaultSubtitle.js';
import { decide } from './decision.js';
import { EncoderProcess, type EncoderHandle, type EncoderProcessOptions } from './encoderProcess.js';
import { FallingBehindWatch } from './fallingBehind.js';
import { buildFfmpegArgs } from './ffmpegArgs.js';
import { MemoryWatchdog, imageNameOf, createWorkingSetSampler, type MemoryLimitHit } from './memoryWatchdog.js';
import { SessionMonitor } from './monitor.js';
import { cleanupOrphans, PID_FILE_NAME, PidRegistry } from './pidRegistry.js';
import {
  SEGMENT_SECONDS,
  generateMasterPlaylist,
  generatePlaylist,
  generateSubtitlePlaylist,
  segmentCount,
  segmentFileName,
  segmentFormatFor,
  contentTypeFor,
  type HlsFile,
} from './playlist.js';
import type { RawProgress } from './progress.js';
import { SegmentStore } from './segmentStore.js';
import { toActivitySession, toSessionResponse, type SessionRecord } from './session.js';
import {
  extractorLimit,
  isHeavySource,
  limitLabel,
  maxExtractorRuns,
  STARVED_BYTES_PER_SEC,
  type LimitLabel,
} from './extractorSchedule.js';
import { SubtitleExtractor, selectTextTracks } from './subtitleExtractor.js';
import { burnTarget, planPatch, requireAudio, requireSubtitle } from './tracks.js';
import { renderSegment } from './vtt.js';

export const SEGMENT_WAIT_MS = 30_000;
export const FIRST_SEGMENT_WAIT_MS = 30_000;
/** Candidates an automatic start tries before it gives up. */
export const MAX_START_ATTEMPTS = 3;
const FIRST_SEGMENT_POLL_MS = 25;
/** A segment further ahead of the encoder than this triggers a restart at the requested position. */
export const SEEK_WINDOW_SEGMENTS = 5;
/** Two streams at a time keeps the GPU to at most two encoders (AGENTS.md GPU safety rule 1). */
export const MAX_SESSIONS = 2;
export const IDLE_TIMEOUT_MS = 120_000;
export const MONITOR_TICK_MS = 2_000;
const POLL_MS = 100;
/** A subtitle segment that no extractor has reached yet is waited for this long before the client is told to retry. */
export const SUBTITLE_HOLD_MS = 6_000;
const SUBTITLE_PLAYLIST_TYPE = 'application/vnd.apple.mpegurl';
const SUBTITLE_SEGMENT_TYPE = 'text/vtt; charset=utf-8';
/** A request that keeps finding its segment evicted or skipped gives up after this many encoder restarts. */
const MAX_SERVE_ATTEMPTS = 3;
const LIMIT_LOG_WINDOW_MS = 120_000;
const SPEED_WINDOW_MS = 4_000;
const SPEED_WINDOW_MIN_MS = 1_500;
const GIB = 1024 ** 3;

export interface PlaybackManagerOptions {
  config: Config;
  db: Db;
  bus: EventBus;
  logger: FastifyBaseLogger;
  tmdb: TmdbService;
  streams: StreamService;
  /** Every ffprobe/ffmpeg input of a session is a loopback URL served by this proxy. */
  proxy: SourceProxy;
  segmentWaitMs?: number;
  /** How long a start waits for the encoder's first segment before it counts as failed. */
  firstSegmentWaitMs?: number;
  subtitleHoldMs?: number;
  maxSessions?: number;
  /** Test seam: replaces the ffmpeg child of the session encoder. */
  createEncoder?: (options: EncoderProcessOptions) => EncoderHandle;
  idleTimeoutMs?: number;
  /** Housekeeping interval; 0 disables the timer (tests call `monitorTick()` themselves). */
  monitorTickMs?: number;
}

export interface PingUpdate {
  positionSec: number;
  state?: PingState;
}

type TitleDetails = Pick<MovieDetails | ShowDetails, 'title' | 'originalLanguage' | 'posterUrl' | 'backdropUrl'>;

type StopReason = 'stopped' | 'idle' | 'disk' | 'shutdown';
type WaitOutcome = 'ready' | 'lost';

export type ServedFile =
  | { kind: 'text'; body: string; contentType: string; headers?: Record<string, string> }
  | { kind: 'file'; path: string; size: number; contentType: string };

function notFound(message: string, hint = 'Start a new playback session.'): AppError {
  return new AppError(404, 'not_found', message, hint);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Errors about the request or the server itself: another stream would fail the same way. */
const NOT_THE_STREAMS_FAULT = new Set(['invalid_audio_index', 'invalid_subtitle_index', 'subtitle_mode_unsupported', 'shutting_down']);

function isStreamFault(error: unknown): boolean {
  return !(error instanceof AppError && NOT_THE_STREAMS_FAULT.has(error.code));
}

/** ffmpeg echoes the input URL (with its token) in many errors; none of that may reach users or logs. */
function scrub(text: string): string {
  return redact(text).replace(/\b(?:https?|ftp):\/\/\S+/gi, '<url>');
}

export class PlaybackManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly limitLabels = new WeakMap<SessionRecord, LimitLabel>();
  private readonly speedWindows = new WeakMap<SessionRecord, Array<{ at: number; outSec: number }>>();
  private readonly fallingBehind = new FallingBehindWatch();
  private readonly proxy: SourceProxy;
  private readonly segmentWaitMs: number;
  private readonly subtitleHoldMs: number;
  private readonly firstSegmentWaitMs: number;
  private readonly maxSessions: number;
  private readonly registry: PidRegistry;
  private readonly monitor: SessionMonitor;
  private readonly watchdog: MemoryWatchdog;
  private timer: NodeJS.Timeout | null = null;
  private starting = 0;
  private libplaceboBroken = false;

  constructor(private readonly options: PlaybackManagerOptions) {
    this.proxy = options.proxy;
    this.segmentWaitMs = options.segmentWaitMs ?? SEGMENT_WAIT_MS;
    this.subtitleHoldMs = options.subtitleHoldMs ?? SUBTITLE_HOLD_MS;
    this.firstSegmentWaitMs = options.firstSegmentWaitMs ?? FIRST_SEGMENT_WAIT_MS;
    this.maxSessions = options.maxSessions ?? MAX_SESSIONS;
    this.registry = new PidRegistry(path.join(options.config.dataDir, PID_FILE_NAME));
    this.watchdog = new MemoryWatchdog({
      limitMb: options.config.ffmpegMaxRssMb,
      sample: createWorkingSetSampler(imageNameOf(options.config.ffmpegPath)),
    });
    this.monitor = new SessionMonitor(
      {
        liveSessions: () => this.liveRecords(),
        allSessions: () => [...this.sessions.values()].filter((rec) => !rec.stopping && !rec.opening),
        stopIdle: (rec) => this.stopIdle(rec),
        stopForDisk: (rec) => this.stopForDisk(rec),
        park: (rec) => this.park(rec),
        resume: (rec) => this.resume(rec),
        publish: (rec) => this.options.bus.emit('session.update', toActivitySession(rec)),
      },
      { idleTimeoutMs: options.idleTimeoutMs ?? IDLE_TIMEOUT_MS, capBytes: options.config.transcodeMaxGb * GIB },
    );
  }

  /** Kills ffmpeg processes left by a crashed server run and wipes stale session directories. Call once at server start. */
  async recoverOrphans(): Promise<void> {
    const { killed, wipedDirs } = await cleanupOrphans(this.registry, this.options.config.transcodeDir);
    if (killed.length > 0 || wipedDirs.length > 0) {
      this.event({
        level: 'warn',
        source: 'session',
        message: `Cleaned up after an unclean shutdown: stopped ${killed.length} leftover ffmpeg process(es), removed ${wipedDirs.length} stale session folder(s).`,
        details: { killedPids: killed },
      });
    }
  }

  async start(body: SessionStartRequest, clientIp: string | null): Promise<SessionResponse> {
    this.reserveSlot();
    try {
      return await this.startSession(body, clientIp);
    } finally {
      this.starting -= 1;
    }
  }

  private reserveSlot(): void {
    if (this.liveRecords().length + this.starting >= this.maxSessions) {
      throw new AppError(
        429,
        'too_many_sessions',
        'Two streams are already playing. Stop one to start another.',
        'Stop playback on another device, or wait a couple of minutes for idle sessions to time out, then try again.',
      );
    }
    this.starting += 1;
  }

  private async startSession(body: SessionStartRequest, clientIp: string | null): Promise<SessionResponse> {
    const { db, tmdb } = this.options;

    const details = body.mediaType === 'movie' ? await tmdb.movie(body.tmdbId) : await tmdb.show(body.tmdbId);
    const device = upsertDevice(db, body.device, clientIp).capabilities;

    const plan = await this.planStart(body, details.imdbId, device);
    const attempts: StartAttempt[] = [];
    for (const streamId of plan.streamIds) {
      try {
        return await this.attemptStart(body, clientIp, { streamId, device, details, attempts });
      } catch (error) {
        // An explicit stream id gets one try, and a refused request or a shutdown is not the stream's fault.
        if (!plan.auto || !isStreamFault(error)) throw error;
        const code = error instanceof AppError ? error.code : 'start_failed';
        attempts.push({ streamId, code });
        this.event({
          level: 'warn',
          source: 'session',
          message: `Stream ${attempts.length} of ${plan.streamIds.length} could not be started (${code}); ${attempts.length < plan.streamIds.length ? 'trying the next one' : 'no more candidates'}.`,
          details: { streamId, code, detail: scrub(error instanceof Error ? error.message : String(error)) },
        });
        // An uncached title has a single candidate; its own error (for example "not cached yet") says more than a list of failures.
        if (!plan.cached) throw error;
      }
    }
    throw new AllStreamsFailedError(attempts);
  }

  /** The stream ids an automatic start tries in order (the best-ranked cached streams that fit the device), or the one explicit id. */
  private async planStart(
    body: SessionStartRequest,
    imdbId: string | null,
    device: CapabilityProfile,
  ): Promise<{ streamIds: string[]; auto: boolean; cached: boolean }> {
    if (body.streamId !== 'auto') return { streamIds: [body.streamId], auto: false, cached: true };
    if (!imdbId) throw new AppError(404, 'no_streams', 'No streams are available for this title.', 'Try another title.');
    const query =
      body.mediaType === 'movie'
        ? ({ type: 'movie', imdbId } as const)
        : ({ type: 'tv', imdbId, season: body.season as number, episode: body.episode as number } as const);
    const listed = await this.options.streams.list(query, device.deviceId);
    const picked = startCandidates(listed.streams, deviceMaxRank(device), MAX_START_ATTEMPTS);
    if (picked.streams.length === 0) {
      throw new AppError(404, 'no_streams', 'No streams are available for this title.', 'Try another title or check the gateway on the health dashboard.');
    }
    return { streamIds: picked.streams.map((stream) => stream.id), auto: true, cached: picked.cached };
  }

  /** One candidate: resolve, probe, start the encoder and wait for its first segment. Leaves nothing behind when it fails. */
  private async attemptStart(
    body: SessionStartRequest,
    clientIp: string | null,
    context: { streamId: string; device: CapabilityProfile; details: TitleDetails; attempts: StartAttempt[] },
  ): Promise<SessionResponse> {
    const { streams } = this.options;
    const id = randomUUID();
    const t0 = Date.now();
    const stream = await streams.getStreamById(context.streamId);
    if (!stream) {
      throw new AppError(404, 'stream_not_found', 'That stream is no longer available.', 'Use streamId "auto", or list the streams again to get current ids.');
    }
    const t1 = Date.now();
    // A prefetch of the same stream has already resolved the link, warmed the proxy and run ffprobe.
    const source = await this.proxy.acquire(stream.url, id);
    try {
      return await this.startWithSource(body, clientIp, { ...context, id, stream, source, timings: { t0, t1 } });
    } catch (error) {
      source.release();
      throw error;
    }
  }

  private async startWithSource(
    body: SessionStartRequest,
    clientIp: string | null,
    context: {
      id: string;
      stream: ResolvedStream;
      source: SourceHandle;
      device: CapabilityProfile;
      details: TitleDetails;
      attempts: StartAttempt[];
      timings: { t0: number; t1: number };
    },
  ): Promise<SessionResponse> {
    const { config, db } = this.options;
    const { id, stream, source, device, details } = context;
    const t2 = Date.now();
    const probe = await source.probe();
    const timingsMs = { pickStream: context.timings.t1 - context.timings.t0, source: t2 - context.timings.t1, probe: Date.now() - t2 };

    const audio = requireAudio(probe, body.audioIndex);
    const automatic = body.subtitle === undefined ? chooseDefaultSubtitle(probe.subtitles, audio, details.originalLanguage) : null;
    const subtitle = automatic ? automatic.selection : requireSubtitle(probe, body.subtitle);
    const textTracks = selectTextTracks(probe, subtitle?.mode === 'sidecar' ? subtitle.index : null);

    const decision = decide({ video: probe.video, audio, device, subtitleBurnIn: subtitle?.mode === 'burn' });
    const format = segmentFormatFor(decision.videoCodec);
    const dir = path.join(config.transcodeDir, id);
    const total = segmentCount(probe.durationSec);
    const startSegment = Math.min(total - 1, Math.floor((body.startPositionSec ?? 0) / SEGMENT_SECONDS));

    const title = await this.titleFor(body, details.title);
    const mediaKey = mediaKeyFor(body.mediaType, body.tmdbId, body.season, body.episode);
    const now = Date.now();
    const rec: SessionRecord = {
      id,
      dir,
      meta: {
        mediaKey,
        mediaType: body.mediaType,
        tmdbId: body.tmdbId,
        title: title.title,
        showTitle: title.showTitle,
        season: body.season ?? null,
        episode: body.episode ?? null,
        streamFilename: stream.stream.filename,
        clientIp,
        posterUrl: details.posterUrl,
        backdropUrl: title.stillUrl ?? details.backdropUrl,
      },
      store: new SegmentStore(dir),
      device,
      source,
      probe,
      decision,
      format,
      selectedAudioIndex: audio?.index ?? null,
      selectedSubtitle: subtitle,
      subtitleDefault: automatic?.kind ?? null,
      defaultForced: automatic?.forced ?? false,
      textTracks,
      requestedStartSec: body.startPositionSec ?? 0,
      startedAt: now,
      streamId: stream.id,
      attempts: [...context.attempts],
      opening: true,
      state: 'starting',
      error: null,
      errorCode: null,
      stats: { fps: 0, speed: 0, bitrateKbps: 0, outTimeSec: 0, headSegment: startSegment },
      statSamples: { speedSum: 0, speedCount: 0, bitrateSum: 0, bitrateCount: 0 },
      toneMapper: this.libplaceboBroken ? 'opencl' : 'libplacebo',
      process: null,
      subtitles: null,
      startSegment,
      generation: 0,
      retried: false,
      encoderDone: false,
      stopping: false,
      restart: null,
      parked: false,
      lastActivity: now,
      positionSec: body.startPositionSec ?? 0,
      pingedAt: 0,
      playerSegment: startSegment,
      watchedSec: 0,
      pingState: 'playing',
      pingClock: now,
      bytesServed: 0,
    };

    await mkdir(dir, { recursive: true });
    try {
      insertPlay(db, {
        sessionId: id,
        mediaKey,
        type: body.mediaType,
        tmdbId: body.tmdbId,
        title: title.title,
        showTitle: title.showTitle,
        season: body.season ?? null,
        episode: body.episode ?? null,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        deviceKind: device.kind,
        clientIp,
        startedAt: now,
        durationSec: probe.durationSec,
        streamFilename: stream.stream.filename,
        decision,
      });
    } catch (error) {
      await this.removeDir(dir);
      throw error;
    }

    this.sessions.set(id, rec);
    this.ensureTimer();
    this.launch(rec, startSegment);
    this.startSubtitles(rec);
    const tFirst = Date.now();
    try {
      await this.waitForFirstSegment(rec);
    } catch (error) {
      await this.abandon(rec);
      throw error;
    }
    rec.opening = false;
    rec.pingClock = Date.now();
    Object.assign(timingsMs, { firstSegment: Date.now() - tFirst });
    this.options.logger.info({ sessionId: id, decision, timingsMs }, 'Playback session started');
    this.event({
      level: 'info',
      source: 'session',
      message: `Playback started: ${title.showTitle ? `${title.showTitle} - ` : ''}${title.title} on ${device.deviceName}.`,
      details: { decision, timingsMs },
      sessionId: id,
    });
    this.options.bus.emit('session.start', toActivitySession(rec));
    return toSessionResponse(rec);
  }

  /**
   * Waits until the first segment of the new session exists, so a start that cannot produce video fails here instead of
   * after the client has been told it works. The encoder's own retry runs inside this wait.
   */
  private async waitForFirstSegment(rec: SessionRecord): Promise<void> {
    const first = path.join(rec.dir, segmentFileName(rec.startSegment, rec.format));
    const deadline = Date.now() + this.firstSegmentWaitMs;
    for (;;) {
      if (existsSync(first)) {
        this.markReady(rec);
        return;
      }
      if (rec.stopping) throw new AppError(503, 'shutting_down', 'The server is shutting down.', 'Try again in a moment.');
      if (rec.state === 'error') {
        throw new AppError(502, rec.errorCode ?? 'encoder_failed', rec.error?.message ?? 'The encoder failed.', rec.error?.hint);
      }
      if (rec.encoderDone && !rec.process?.running) {
        throw new AppError(502, 'encoder_failed', 'The encoder finished without producing any video.', 'Try again in a moment.');
      }
      if (Date.now() >= deadline) {
        throw new AppError(
          504,
          'encoder_timeout',
          `The encoder produced no video within ${Math.round(this.firstSegmentWaitMs / 1000)} seconds.`,
          'The source may be slow or the encoder stuck; try again, or check the health dashboard.',
        );
      }
      await sleep(FIRST_SEGMENT_POLL_MS);
    }
  }

  /** Throws away a session that never reached its first segment: nothing of it may remain. */
  private async abandon(rec: SessionRecord): Promise<void> {
    if (rec.stopping) return;
    rec.stopping = true;
    rec.state = 'stopped';
    // A new generation keeps the exit handler of the stopped encoder from retrying it.
    rec.generation += 1;
    this.sessions.delete(rec.id);
    this.fallingBehind.forget(rec.id);
    await rec.restart?.catch(() => undefined);
    await Promise.all([rec.process?.stop(), rec.subtitles?.stop()]);
    rec.source.release();
    await this.removeDir(rec.dir);
    deletePlay(this.options.db, rec.id);
  }

  get(id: string): SessionResponse {
    return toSessionResponse(this.require(id));
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  list(): SessionResponse[] {
    return [...this.sessions.values()].filter((rec) => !rec.opening).map(toSessionResponse);
  }

  /** Sessions that are being played or prepared; a failed encode is no longer live. */
  activity(): ActivitySession[] {
    return this.liveRecords()
      .sort((a, b) => a.startedAt - b.startedAt)
      .map(toActivitySession);
  }

  /** Total finished-segment bytes across live sessions and the configured cap. */
  diskUsage(): { bytes: number; capBytes: number } {
    let bytes = 0;
    for (const rec of this.sessions.values()) bytes += rec.store.totalBytes;
    return { bytes, capBytes: this.options.config.transcodeMaxGb * GIB };
  }

  /** Marks client activity that is not an HLS request (progress pings, subtitle fetches). */
  touch(id: string): void {
    this.require(id).lastActivity = Date.now();
  }

  /**
   * Records a progress ping: counts as activity, updates the reported position and the playing/paused/buffering state, adds the
   * playing time since the previous ping to the play record and saves the resume position.
   */
  ping(id: string, update: PingUpdate): ProgressResponse {
    const rec = this.require(id);
    const now = Date.now();
    rec.lastActivity = now;
    rec.pingedAt = now;
    rec.positionSec = Math.max(0, update.positionSec);
    rec.playerSegment = Math.floor(rec.positionSec / SEGMENT_SECONDS);
    this.followPlayhead(rec);
    const state = update.state ?? 'playing';
    if (rec.state === 'ready' || rec.state === 'playing' || rec.state === 'paused' || rec.state === 'buffering') rec.state = state;

    rec.watchedSec += playingSecondsSince(rec.pingState, now - rec.pingClock);
    rec.pingClock = now;
    rec.pingState = state;
    return this.saveProgress(rec, now);
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
      updatePlayProgress(db, rec.id, { watchedSec: rec.watchedSec, lastPositionSec: positionSec, completed, bytesServed: rec.bytesServed });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { mediaKey: meta.mediaKey, positionSec, durationSec, completed, resumable: isResumable(positionSec, completed) };
  }

  /**
   * Switches the audio track and/or the subtitle choice. A new audio track or a changed burn-in restarts the one ffmpeg of the
   * session at the player's position; the playlist URL and segment names stay the same, so the client only reloads the player.
   * Choosing a text subtitle only records the choice: the WebVTT file is shown by the player.
   */
  async patch(id: string, body: SessionPatchRequest): Promise<SessionResponse> {
    const rec = this.require(id);
    while (rec.restart) await rec.restart.catch(() => undefined);
    if (rec.stopping) throw notFound('This session has ended.');
    if (rec.state === 'error') {
      throw new AppError(409, 'session_failed', 'This playback session has failed and cannot switch tracks.', 'Start a new playback session.');
    }

    const plan = planPatch(rec.probe, { audioIndex: rec.selectedAudioIndex, subtitle: rec.selectedSubtitle }, body);
    rec.lastActivity = Date.now();
    rec.selectedSubtitle = plan.subtitle;
    if (body.subtitle !== undefined) rec.subtitleDefault = null;
    if (!plan.restart) return toSessionResponse(rec);

    rec.selectedAudioIndex = plan.audio?.index ?? null;
    rec.decision = decide({ video: rec.probe.video, audio: plan.audio, device: rec.device, subtitleBurnIn: plan.subtitle?.mode === 'burn' });
    updatePlayDecision(this.options.db, rec.id, rec.decision);
    const segment = Math.min(segmentCount(rec.probe.durationSec) - 1, Math.floor(rec.positionSec / SEGMENT_SECONDS));
    this.event({
      level: 'info',
      source: 'session',
      message: `Playback tracks changed (audio ${plan.audio?.index ?? 'none'}, subtitles ${plan.subtitle ? `${plan.subtitle.mode} ${plan.subtitle.index}` : 'off'}); restarting the encoder at segment ${segment}.`,
      sessionId: rec.id,
    });
    rec.restart = this.reconfigure(rec, segment).finally(() => {
      rec.restart = null;
    });
    await rec.restart;
    return toSessionResponse(rec);
  }

  /** Output of the previous track selection is thrown away, including init.mp4 whose audio parameters may differ. */
  private async reconfigure(rec: SessionRecord, segment: number): Promise<void> {
    const previous = rec.process;
    rec.generation += 1;
    await previous?.stop();
    if (rec.stopping) return;
    for (const name of await readdir(rec.dir).catch(() => [] as string[])) {
      if (/^seg-\d+\.(?:ts|m4s)$/.test(name) || name === 'init-ready.mp4') {
        await rm(path.join(rec.dir, name), { force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
      }
    }
    rec.store.forget(0);
    rec.retried = false;
    this.launch(rec, segment);
  }

  /** The extractor of a session whose text track `index` has a rendition; touches the session. */
  private subtitleTrack(id: string, index: number): { rec: SessionRecord; extractor: SubtitleExtractor } {
    const rec = this.require(id);
    rec.lastActivity = Date.now();
    const extractor = rec.subtitles;
    if (!extractor?.store.has(index)) {
      throw notFound(`Subtitle track ${index} is not a text track of this session.`, 'Use the subtitle urls listed in the session or in index.m3u8.');
    }
    return { rec, extractor };
  }

  serveSubtitlePlaylist(id: string, index: number): ServedFile {
    const { rec } = this.subtitleTrack(id, index);
    return { kind: 'text', body: generateSubtitlePlaylist(rec.probe.durationSec), contentType: SUBTITLE_PLAYLIST_TYPE };
  }

  /**
   * A segment whose time range no extractor has read yet is waited for (and an extractor is steered to it); only then does the
   * client get a 503 to retry. A covered segment always has its full cues, so an empty 200 never stands in for missing data.
   */
  async serveSubtitleSegment(id: string, index: number, segment: number, signal?: AbortSignal): Promise<ServedFile> {
    const { rec, extractor } = this.subtitleTrack(id, index);
    const { store } = extractor;
    if (segment >= store.segmentTotal) {
      throw notFound(`Subtitle segment ${segment} does not exist in this session.`, 'Use the segment names listed in the rendition playlist.');
    }
    const deadline = Date.now() + this.subtitleHoldMs;
    for (;;) {
      rec.lastActivity = Date.now();
      if (store.segmentCovered(segment)) {
        return { kind: 'text', body: store.segment(index, segment), contentType: SUBTITLE_SEGMENT_TYPE };
      }
      if (store.status() === 'error') {
        return {
          kind: 'text',
          body: renderSegment([], 0, 0),
          contentType: SUBTITLE_SEGMENT_TYPE,
          headers: { 'X-Subtitle-Status': 'failed' },
        };
      }
      if (rec.stopping) throw notFound('This session has ended.');
      // Cues beyond the read-ahead window are not read yet: the request keeps getting 503 until the player is closer.
      if (segment * SEGMENT_SECONDS <= this.reachSec(rec) + this.options.config.readAheadSec) {
        extractor.ensureExtractorFor(segment * SEGMENT_SECONDS);
      }
      if (Date.now() >= deadline || signal?.aborted) break;
      await sleep(POLL_MS);
    }
    throw new AppError(
      503,
      'subtitle_not_ready',
      `Subtitle segment ${segment} is not extracted yet.`,
      'Retry the request in a second.',
      { 'Retry-After': '1', 'Cache-Control': 'no-store' },
    );
  }

  serveSubtitleFull(id: string, index: number): ServedFile {
    const { extractor } = this.subtitleTrack(id, index);
    if (!extractor.store.complete) {
      throw new AppError(404, 'subtitle_not_ready', `Subtitle track ${index} is still being extracted.`, 'Wait until fullUrl is set in the session, then fetch it.');
    }
    return { kind: 'text', body: extractor.store.full(index), contentType: SUBTITLE_SEGMENT_TYPE };
  }

  async monitorTick(): Promise<void> {
    this.observeSpeeds();
    await this.monitor.tick();
  }

  async stop(id: string): Promise<void> {
    await this.end(this.require(id), 'stopped');
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((rec) => this.end(rec, 'shutdown')));
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.stopAll();
    this.watchdog.close();
  }

  async serve(id: string, file: HlsFile): Promise<ServedFile> {
    const rec = this.require(id);
    rec.lastActivity = Date.now();
    const contentType = contentTypeFor(file);

    if (file.kind === 'master') {
      const body = generateMasterPlaylist({
        decision: rec.decision,
        fps: rec.probe.video.fps,
        tracks: rec.textTracks,
        defaultTrack:
          rec.subtitleDefault && rec.selectedSubtitle?.mode === 'sidecar'
            ? { index: rec.selectedSubtitle.index, forced: rec.defaultForced }
            : null,
      });
      return { kind: 'text', body, contentType };
    }
    if (file.kind === 'playlist') {
      return { kind: 'text', body: generatePlaylist(rec.probe.durationSec, rec.format), contentType };
    }
    if (file.kind === 'init') {
      if (rec.format !== 'fmp4') throw notFound('This session has no init segment.', 'MPEG-TS sessions are self-contained.');
      return this.counted(rec, await this.initResponse(rec, contentType));
    }

    const expectedExtension = rec.format === 'fmp4' ? 'm4s' : 'ts';
    if (file.extension !== expectedExtension || file.index >= segmentCount(rec.probe.durationSec)) {
      throw notFound(`Segment ${file.index} does not exist in this session.`, 'Use the segment names listed in video.m3u8.');
    }
    // A track switch replaces the files on disk; nothing from before it may be served.
    while (rec.restart) await rec.restart.catch(() => undefined);
    rec.playerSegment = file.index;
    if (Date.now() - rec.pingedAt > 30_000) rec.positionSec = file.index * SEGMENT_SECONDS;
    this.followPlayhead(rec);

    const target = path.join(rec.dir, segmentFileName(file.index, rec.format));
    for (let attempt = 1; ; attempt += 1) {
      if (!existsSync(target)) await this.ensureEncoder(rec, file.index);
      if ((await this.waitForFile(rec, target, file.index)) === 'ready') break;
      if (attempt >= MAX_SERVE_ATTEMPTS) {
        throw new AppError(504, 'segment_timeout', `Segment ${file.index} was not ready in time.`, 'The encoder is busy with another seek; try again.');
      }
    }
    this.markReady(rec);
    rec.lastActivity = Date.now();
    return this.counted(rec, { kind: 'file', path: target, size: statSync(target).size, contentType });
  }

  /**
   * ffmpeg creates init.mp4 early but only finishes it together with the first segment of a run, and every run rewrites
   * it (with identical content, thanks to frag_discont). The served copy is therefore taken once, after a run finished
   * its first segment, so a half-written file is never served.
   */
  private async initResponse(rec: SessionRecord, contentType: string): Promise<ServedFile> {
    const ready = path.join(rec.dir, 'init-ready.mp4');
    while (!existsSync(ready)) {
      const generation = await this.runWithFinishedFirstSegment(rec);
      const temp = path.join(rec.dir, `init-${randomUUID()}.tmp`);
      await copyFile(path.join(rec.dir, 'init.mp4'), temp);
      if (rec.generation !== generation) {
        // A restart began while copying, so the copy may be torn.
        await rm(temp, { force: true });
        continue;
      }
      await rename(temp, ready);
    }
    return { kind: 'file', path: ready, size: statSync(ready).size, contentType };
  }

  /** Waits until the current ffmpeg run has finished its first segment, which also completes that run's init.mp4. */
  private async runWithFinishedFirstSegment(rec: SessionRecord): Promise<number> {
    const deadline = Date.now() + this.segmentWaitMs;
    for (;;) {
      const first = path.join(rec.dir, segmentFileName(rec.startSegment, rec.format));
      const produced = rec.stats.headSegment > rec.startSegment || rec.encoderDone;
      // A stopped run left its init.mp4 complete even when disk eviction already removed its first segment.
      if (!rec.restart && produced && (existsSync(first) || !rec.process?.running)) return rec.generation;
      if (rec.stopping) throw notFound('This session has ended.');
      if (rec.state === 'error') {
        throw new AppError(502, rec.errorCode ?? 'encoder_failed', rec.error?.message ?? 'The encoder failed.', rec.error?.hint);
      }
      if (Date.now() >= deadline) {
        throw new AppError(504, 'segment_timeout', 'The encoder did not start in time.', 'The encoder is behind; try again, or check the health dashboard.');
      }
      await sleep(POLL_MS);
    }
  }

  private require(id: string): SessionRecord {
    const rec = this.sessions.get(id);
    if (!rec) throw notFound(`Session ${id.slice(0, 64)} was not found.`);
    return rec;
  }

  /** Sessions the clients know about and that are not failed; one still opening is counted by `starting` instead. */
  private liveRecords(): SessionRecord[] {
    return [...this.sessions.values()].filter((rec) => rec.state !== 'error' && !rec.stopping && !rec.opening);
  }

  private ensureTimer(): void {
    const interval = this.options.monitorTickMs ?? MONITOR_TICK_MS;
    if (this.timer || interval <= 0) return;
    this.timer = setInterval(() => {
      this.observeSpeeds();
      void this.monitor.tick().catch((error: unknown) => this.options.logger.warn({ err: error }, 'Session housekeeping failed'));
    }, interval);
    this.timer.unref();
  }

  private event(input: LogEventInput): void {
    try {
      logEvent({ db: this.options.db, bus: this.options.bus }, input);
    } catch (error) {
      this.options.logger.warn({ err: error }, 'Could not record an event');
    }
  }

  private async titleFor(
    body: SessionStartRequest,
    name: string,
  ): Promise<{ title: string; showTitle: string | null; stillUrl: string | null }> {
    if (body.mediaType === 'movie') return { title: name, showTitle: null, stillUrl: null };
    const code = `S${String(body.season).padStart(2, '0')}E${String(body.episode).padStart(2, '0')}`;
    try {
      const season = await this.options.tmdb.season(body.tmdbId, body.season as number);
      const episode = season.episodes.find((item) => item.episodeNumber === body.episode);
      return { title: episode?.name || `${name} ${code}`, showTitle: name, stillUrl: episode?.stillUrl ?? null };
    } catch {
      return { title: `${name} ${code}`, showTitle: name, stillUrl: null };
    }
  }

  private launch(rec: SessionRecord, startSegment: number): void {
    if (rec.state === 'error') return;
    rec.startSegment = startSegment;
    rec.generation += 1;
    rec.encoderDone = false;
    rec.parked = false;
    rec.store.forget(startSegment);
    this.speedWindows.delete(rec);
    rec.stats = { ...rec.stats, headSegment: startSegment, outTimeSec: startSegment * SEGMENT_SECONDS };
    // The read-ahead window is measured from where this run starts, so a start, seek or restart downloads at full speed again.
    rec.source.resetReadAhead();
    this.fallingBehind.forget(rec.id);
    const generation = rec.generation;

    rec.source.setExtractorLimit(STARVED_BYTES_PER_SEC);

    const args = buildFfmpegArgs({
      inputUrl: rec.source.url,
      sessionDir: rec.dir,
      decision: rec.decision,
      video: rec.probe.video,
      audioIndex: rec.selectedAudioIndex,
      startSegment,
      toneMapper: rec.toneMapper,
      burn: burnTarget(rec.probe, rec.selectedSubtitle),
      threads: { gpu: this.options.config.ffmpegThreads, cpu: this.options.config.ffmpegBurnThreads },
    });
    const proc = (this.options.createEncoder ?? ((options) => new EncoderProcess(options)))({
      ffmpegPath: this.options.config.ffmpegPath,
      args,
      cwd: rec.dir,
      onProgress: (progress) => {
        if (rec.generation === generation) this.onProgress(rec, progress);
      },
      watchdog: this.watchdog,
      onMemoryLimit: (hit) => this.onMemoryLimit(rec, 'The video encoder', hit),
    });
    rec.process = proc;
    const pid = proc.pid;
    if (pid !== undefined) this.registry.add({ pid, sessionId: rec.id, startedAt: Date.now() });
    void proc.exited.then((exit) => {
      if (pid !== undefined) this.registry.remove(pid);
      if (rec.generation !== generation || rec.stopping) return;
      if (exit.code === 0) {
        rec.encoderDone = true;
        rec.source.setExtractorLimit(null);
        this.markReady(rec);
        return;
      }
      void this.recover(rec, exit.code, exit.stderrTail);
    });
  }

  private onProgress(rec: SessionRecord, progress: RawProgress): void {
    const last = segmentCount(rec.probe.durationSec) - 1;
    // ffmpeg reports output time relative to the run's first segment.
    const head = Math.min(last, rec.startSegment + Math.floor(progress.outTimeSec / SEGMENT_SECONDS));
    // The HLS muxer reports no bitrate, so it is derived from segment sizes by the monitor.
    const bitrateKbps = progress.bitrateKbps > 0 ? progress.bitrateKbps : rec.stats.bitrateKbps;
    rec.stats = { ...progress, bitrateKbps, outTimeSec: progress.outTimeSec + rec.startSegment * SEGMENT_SECONDS, headSegment: head };
    if (progress.speed > 0) {
      rec.statSamples.speedSum += progress.speed;
      rec.statSamples.speedCount += 1;
    }
    this.trackSpeed(rec);
    this.syncReadAhead(rec);
    this.updateStarved(rec);
    this.markReady(rec);
  }

  private followPlayhead(rec: SessionRecord): void {
    rec.source.setPlayhead(rec.positionSec / rec.probe.durationSec);
    this.syncReadAhead(rec);
    this.updateStarved(rec);
  }

  /** Seconds of encoded video ahead of the player; the player's position cannot be before the start of the current run. */
  private leadSec(rec: SessionRecord): number {
    return leadSeconds(rec.stats.headSegment, SEGMENT_SECONDS, Math.max(rec.positionSec, rec.startSegment * SEGMENT_SECONDS));
  }

  /** How far the subtitle extractors may read: the player's position, including a segment it has just asked for after a seek. */
  private reachSec(rec: SessionRecord): number {
    return Math.max(rec.positionSec, rec.playerSegment * SEGMENT_SECONDS);
  }

  private syncReadAhead(rec: SessionRecord): void {
    rec.source.setLead(this.leadSec(rec));
    rec.subtitles?.syncHolds();
  }

  /** Per-session download figures for the health `network` check. */
  networkSessions(): NetworkSession[] {
    return this.liveRecords().map((rec) => ({
      sessionId: rec.id,
      rateMbps: rec.source.rateMbps(),
      readAhead: rec.source.readAhead,
      leadSec: rec.source.leadSec,
    }));
  }

  /** Sessions whose encoder has been slower than real time for over 30 s while catching up; one waiting at its window never counts. */
  fallingBehindSessions(): string[] {
    this.observeSpeeds();
    return this.fallingBehind.fallingBehind(Date.now());
  }

  private observeSpeeds(): void {
    const now = Date.now();
    for (const rec of this.liveRecords()) {
      this.fallingBehind.observe(
        rec.id,
        { speed: this.recentSpeed(rec), readAhead: rec.source.readAhead, idle: rec.encoderDone || rec.parked || !rec.process?.running },
        now,
      );
    }
  }

  /** Subtitle extraction must not compete with an encoder that has little lead over the player or runs slower than 1.2x. */
  private updateStarved(rec: SessionRecord): void {
    const limit = extractorLimit({
      heavy: this.isHeavy(rec),
      bursting: rec.subtitles?.bursting ?? false,
      encoder: {
        done: rec.encoderDone,
        startSegment: rec.startSegment,
        headSegment: rec.stats.headSegment,
        playerSegment: rec.playerSegment,
        speed: rec.stats.speed,
        recentSpeed: this.recentSpeed(rec),
      },
    });
    rec.source.setExtractorLimit(limit);
    const label = limitLabel(limit);
    if (this.limitLabels.get(rec) !== label) {
      this.limitLabels.set(rec, label);
      // The trail is for the start-up phase; later flapping would only add noise.
      if (Date.now() - rec.startedAt < LIMIT_LOG_WINDOW_MS) this.options.logger.info(
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

  private isHeavy(rec: SessionRecord): boolean {
    return isHeavySource({ height: rec.probe.video.height, sizeBytes: rec.source.sizeBytes, durationSec: rec.probe.durationSec });
  }

  /** Encoder speed over the last few seconds; ffmpeg's own figure averages the whole run and reacts too late. 0 while unknown. */
  private recentSpeed(rec: SessionRecord): number {
    const window = this.speedWindows.get(rec);
    const first = window?.[0];
    const last = window?.at(-1);
    if (!first || !last || last.at - first.at < SPEED_WINDOW_MIN_MS) return 0;
    return (last.outSec - first.outSec) / ((last.at - first.at) / 1000);
  }

  private trackSpeed(rec: SessionRecord): void {
    const now = Date.now();
    const window = this.speedWindows.get(rec) ?? [];
    window.push({ at: now, outSec: rec.stats.outTimeSec });
    while (window.length > 2 && now - (window[1] as { at: number }).at >= SPEED_WINDOW_MS) window.shift();
    this.speedWindows.set(rec, window);
  }

  private markReady(rec: SessionRecord): void {
    if (rec.state === 'starting' && existsSync(path.join(rec.dir, segmentFileName(rec.startSegment, rec.format)))) {
      rec.state = 'ready';
      this.options.bus.emit('session.update', toActivitySession(rec));
    }
  }

  /** The main extractor starts together with the encoder: cues for the start position must not wait for the first segment. */
  private startSubtitles(rec: SessionRecord): void {
    const tracks = rec.textTracks.map((track) => track.index);
    if (tracks.length === 0) return;
    rec.subtitles = new SubtitleExtractor({
      ffmpegPath: this.options.config.ffmpegPath,
      sessionId: rec.id,
      sessionDir: rec.dir,
      inputUrl: (runId) => rec.source.extractorRunUrl(runId),
      readAhead: {
        holdSec: this.options.config.readAheadSec,
        resumeSec: this.options.config.readAheadResumeSec,
        playheadSec: () => this.reachSec(rec),
        setHold: (runId, held) => rec.source.setExtractorHold(runId, held),
      },
      videoIndex: rec.probe.video.index,
      durationSec: rec.probe.durationSec,
      tracks,
      maxRuns: maxExtractorRuns(this.isHeavy(rec)),
      onRunEvent: (run) =>
        this.options.logger.info(
          { sessionId: rec.id, sinceStartMs: Date.now() - rec.startedAt, ...run },
          `Subtitle extractor run ${run.event === 'start' ? 'started' : 'stopped'}`,
        ),
      registry: this.registry,
      watchdog: this.watchdog,
      onMemoryLimit: (hit) => this.onMemoryLimit(rec, 'The subtitle extractor', hit),
      onFailure: (exit) => {
        this.event({
          level: 'warn',
          source: 'ffmpeg',
          message: `Could not extract subtitle tracks ${tracks.join(', ')} to WebVTT; the unread parts stay unavailable for this session.`,
          details: { tracks, detail: scrub(exit.stderrTail.split(/\r?\n/).filter(Boolean).at(-1) ?? '') },
          sessionId: rec.id,
        });
      },
    });
    rec.subtitles.start(rec.requestedStartSec);
    this.updateStarved(rec);
  }

  /** First failure: re-resolve the CDN link (and fall back from libplacebo) and carry on. Second failure ends the session. */
  private async recover(rec: SessionRecord, code: number | null, stderrTail: string): Promise<void> {
    if (rec.retried) {
      await this.fail(rec, code, stderrTail);
      return;
    }
    rec.retried = true;
    this.event({
      level: 'warn',
      source: 'ffmpeg',
      message: `The video encoder stopped (code ${code ?? 'none'}); retrying once with a fresh stream link.`,
      details: { detail: scrub(stderrTail.split(/\r?\n/).filter(Boolean).at(-1) ?? '') },
      sessionId: rec.id,
    });
    if (rec.decision.toneMapped && rec.toneMapper === 'libplacebo' && !this.hasSegment(rec, rec.startSegment)) {
      rec.toneMapper = 'opencl';
      this.libplaceboBroken = true;
      this.options.logger.warn({ sessionId: rec.id }, 'libplacebo tone mapping failed to start; falling back to tonemap_opencl');
    }
    // The proxy re-resolves expired links by itself; this covers the encoder failing for another reason with a stale link.
    await rec.source.refresh().catch(() => undefined);
    if (rec.stopping) return;
    this.launch(rec, this.resumePoint(rec));
  }

  private async fail(rec: SessionRecord, code: number | null, stderrTail: string): Promise<void> {
    const lastLine = scrub(stderrTail.split(/\r?\n/).filter(Boolean).at(-1) ?? '');
    rec.state = 'error';
    rec.error = {
      message: scrub(`The video encoder stopped unexpectedly (code ${code ?? 'none'}). ${lastLine}`.trim()),
      hint: 'Try again. If it keeps happening, check the ffmpeg and GPU tiles on the health dashboard.',
    };
    if (rec.opening) {
      // The start waiting on this session reports the failure (or tries the next stream); no client ever saw the session.
      this.options.logger.warn({ sessionId: rec.id, code, detail: lastLine }, 'ffmpeg failed before the first segment');
      this.event({ level: 'warn', source: 'ffmpeg', message: rec.error.message, details: { code, detail: lastLine }, sessionId: rec.id });
      return;
    }
    this.options.logger.error({ sessionId: rec.id, code, detail: lastLine }, 'ffmpeg failed');
    this.event({
      level: 'error',
      source: 'ffmpeg',
      message: rec.error.message,
      details: { code, detail: lastLine, hint: rec.error.hint },
      sessionId: rec.id,
    });
    finalizePlay(this.options.db, rec.id, {
      endedAt: Date.now(),
      status: 'error',
      errorMessage: rec.error.message,
      ...this.endStats(rec),
    });
    this.options.bus.emit('session.update', toActivitySession(rec));
  }

  /**
   * An ffmpeg process of the session grew past the memory limit. The session ends with an error right away (the generation bump
   * keeps the encoder's exit handler from retrying) and every process of it is stopped gently; the caller already stops the offender.
   */
  private onMemoryLimit(rec: SessionRecord, who: string, hit: MemoryLimitHit): void {
    if (rec.stopping || rec.state === 'error') return;
    const usedMb = Math.round(hit.rssBytes / 1024 ** 2);
    const limitMb = Math.round(hit.limitBytes / 1024 ** 2);
    rec.state = 'error';
    rec.errorCode = 'encoder_memory_limit';
    rec.error = {
      message: ` used  MB of memory (limit  MB) and was stopped to keep your computer responsive.`,
      hint: 'Playback ended. Try again, or switch subtitles off. If it keeps happening, check the ffmpeg tile on the health dashboard.',
    };
    rec.generation += 1;
    rec.source.setExtractorLimit(null);
    this.options.logger.error({ sessionId: rec.id, pid: hit.pid, usedMb, limitMb }, 'ffmpeg stopped by the memory watchdog');
    this.event({
      level: 'error',
      source: 'ffmpeg',
      message: rec.error.message,
      details: { code: 'encoder_memory_limit', pid: hit.pid, usedMb, limitMb, hint: rec.error.hint },
      sessionId: rec.id,
    });
    finalizePlay(this.options.db, rec.id, { endedAt: Date.now(), status: 'error', errorMessage: rec.error.message, ...this.endStats(rec) });
    this.options.bus.emit('session.update', toActivitySession(rec));
    void Promise.all([rec.process?.stop(), rec.subtitles?.stop()]).catch(() => undefined);
  }

  private hasSegment(rec: SessionRecord, index: number): boolean {
    return existsSync(path.join(rec.dir, segmentFileName(index, rec.format)));
  }

  /** Where a stopped run should continue: just past the segments it already finished. */
  private resumePoint(rec: SessionRecord): number {
    let index = Math.max(rec.startSegment, rec.stats.headSegment - 6);
    while (this.hasSegment(rec, index)) index += 1;
    return Math.min(index, segmentCount(rec.probe.durationSec) - 1);
  }

  private isDead(rec: SessionRecord): boolean {
    return rec.state === 'error' || rec.stopping;
  }

  /** True when the running encoder will produce `index` soon: it is at or ahead of the run's start and not too far behind it. */
  private encoderWillProduce(rec: SessionRecord, index: number): boolean {
    if (!rec.process?.running) return false;
    const head = rec.stats.headSegment;
    return index >= rec.startSegment && index >= head - 1 && index <= head + SEEK_WINDOW_SEGMENTS;
  }

  /** A finished segment that is gone from disk (evicted) can only come back through a restart. */
  private isLost(rec: SessionRecord, index: number): boolean {
    if (index < rec.startSegment || rec.parked) return true;
    return !!rec.process?.running && index < rec.stats.headSegment - 1;
  }

  private async ensureEncoder(rec: SessionRecord, index: number): Promise<void> {
    if (this.isDead(rec)) return;
    if (rec.restart) await rec.restart;
    if (this.isDead(rec) || this.encoderWillProduce(rec, index)) return;
    rec.restart = this.restartAt(rec, index).finally(() => {
      rec.restart = null;
    });
    await rec.restart;
  }

  private async restartAt(rec: SessionRecord, index: number): Promise<void> {
    const previous = rec.process;
    rec.generation += 1;
    await previous?.stop();
    if (rec.stopping) return;
    rec.retried = false;
    this.launch(rec, index);
  }

  private async waitForFile(rec: SessionRecord, target: string, segment: number): Promise<WaitOutcome> {
    const deadline = Date.now() + this.segmentWaitMs;
    for (;;) {
      if (existsSync(target)) return 'ready';
      if (rec.stopping) throw notFound('This session has ended.');
      if (rec.state === 'error') {
        throw new AppError(502, rec.errorCode ?? 'encoder_failed', rec.error?.message ?? 'The encoder failed.', rec.error?.hint);
      }
      if (rec.encoderDone && !rec.process?.running) {
        throw notFound(`Segment ${segment} was not produced.`, 'Seek again or restart playback.');
      }
      if (!rec.restart && this.isLost(rec, segment)) return 'lost';
      if (Date.now() >= deadline) {
        throw new AppError(504, 'segment_timeout', `Segment ${segment} was not ready in time.`, 'The encoder is behind; try again, or check the health dashboard.');
      }
      await sleep(POLL_MS);
    }
  }

  private endStats(rec: SessionRecord): { avgBitrateKbps: number | null; avgSpeed: number | null; bytesServed: number } {
    const { speedSum, speedCount, bitrateSum, bitrateCount } = rec.statSamples;
    return {
      avgBitrateKbps: bitrateCount === 0 ? null : bitrateSum / bitrateCount,
      avgSpeed: speedCount === 0 ? null : speedSum / speedCount,
      bytesServed: rec.bytesServed,
    };
  }

  /** Counts the media bytes handed to the client; the figure feeds the bandwidth statistics. */
  private counted(rec: SessionRecord, served: ServedFile): ServedFile {
    if (served.kind === 'file') rec.bytesServed += served.size;
    return served;
  }

  private async stopIdle(rec: SessionRecord): Promise<void> {
    this.event({
      level: 'info',
      source: 'session',
      message: `Playback stopped after ${Math.round((Date.now() - rec.lastActivity) / 1000)} s without activity.`,
      sessionId: rec.id,
    });
    await this.end(rec, 'idle');
  }

  private async stopForDisk(rec: SessionRecord): Promise<void> {
    this.event({
      level: 'warn',
      source: 'session',
      message: 'An idle playback session was stopped to stay within the transcode disk limit.',
      sessionId: rec.id,
    });
    await this.end(rec, 'disk');
  }

  private park(rec: SessionRecord): Promise<void> {
    if (rec.restart || !rec.process?.running) return Promise.resolve();
    rec.restart = (async () => {
      rec.parked = true;
      rec.generation += 1;
      await rec.process?.stop();
    })().finally(() => {
      rec.restart = null;
    });
    return rec.restart;
  }

  private resume(rec: SessionRecord): Promise<void> {
    if (rec.restart || rec.stopping || rec.process?.running) return Promise.resolve();
    this.launch(rec, this.resumePoint(rec));
    return Promise.resolve();
  }

  private async end(rec: SessionRecord, reason: StopReason): Promise<void> {
    if (rec.stopping) return;
    rec.stopping = true;
    const wasError = rec.state === 'error';
    rec.state = 'stopped';
    this.sessions.delete(rec.id);
    this.fallingBehind.forget(rec.id);
    await rec.restart?.catch(() => undefined);
    await Promise.all([rec.process?.stop(), rec.subtitles?.stop()]);
    rec.source.release();
    await this.removeDir(rec.dir);
    if (!wasError) finalizePlay(this.options.db, rec.id, { endedAt: Date.now(), status: 'ok', ...this.endStats(rec) });
    this.options.logger.info({ sessionId: rec.id, reason }, 'Playback session stopped');
    this.options.bus.emit('session.end', { sessionId: rec.id, reason, state: 'stopped' });
  }

  private async removeDir(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch((error: unknown) => {
      this.options.logger.warn({ dir, err: error }, 'Could not delete the session directory');
    });
  }
}
