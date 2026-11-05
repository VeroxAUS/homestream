import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { ActivitySession, SessionPatchRequest, SessionResponse, SessionStartRequest } from '@homestream/shared';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { upsertDevice } from '../db/devices.js';
import { finalizePlay, insertPlay, mediaKeyFor, updatePlayDecision } from '../db/plays.js';
import { AppError } from '../errors.js';
import type { EventBus } from '../events/bus.js';
import { logEvent, type LogEventInput } from '../events/record.js';
import { redact } from '../redact.js';
import type { StreamService } from '../streams/service.js';
import type { TmdbService } from '../tmdb/service.js';
import { decide } from './decision.js';
import { EncoderProcess } from './encoderProcess.js';
import { buildFfmpegArgs } from './ffmpegArgs.js';
import { SessionMonitor } from './monitor.js';
import { cleanupOrphans, PID_FILE_NAME, PidRegistry } from './pidRegistry.js';
import {
  SEGMENT_SECONDS,
  generatePlaylist,
  segmentCount,
  segmentFileName,
  segmentFormatFor,
  contentTypeFor,
  type HlsFile,
} from './playlist.js';
import { createFfprobeRunner, type ProbeRunner } from './probe.js';
import type { RawProgress } from './progress.js';
import { createUrlResolver, type UrlResolver } from './resolveUrl.js';
import { SegmentStore } from './segmentStore.js';
import { toActivitySession, toSessionResponse, type SessionRecord } from './session.js';
import {
  MAX_TEXT_SUBTITLES,
  SubtitleExtractor,
  subtitlePath,
} from './subtitleExtractor.js';
import { burnTarget, planPatch, requireAudio, requireSubtitle } from './tracks.js';

export const SEGMENT_WAIT_MS = 30_000;
/** A segment further ahead of the encoder than this triggers a restart at the requested position. */
export const SEEK_WINDOW_SEGMENTS = 5;
export const MAX_SESSIONS = 4;
export const IDLE_TIMEOUT_MS = 120_000;
export const MONITOR_TICK_MS = 2_000;
const POLL_MS = 100;
/** A request that keeps finding its segment evicted or skipped gives up after this many encoder restarts. */
const MAX_SERVE_ATTEMPTS = 3;
const GIB = 1024 ** 3;

export interface PlaybackManagerOptions {
  config: Config;
  db: Db;
  bus: EventBus;
  logger: FastifyBaseLogger;
  tmdb: TmdbService;
  streams: StreamService;
  probe?: ProbeRunner;
  resolveUrl?: UrlResolver;
  segmentWaitMs?: number;
  maxSessions?: number;
  idleTimeoutMs?: number;
  /** Housekeeping interval; 0 disables the timer (tests call `monitorTick()` themselves). */
  monitorTickMs?: number;
}

export interface PingUpdate {
  positionSec: number;
  state?: 'playing' | 'paused' | 'buffering';
}

type StopReason = 'stopped' | 'idle' | 'disk' | 'shutdown';
type WaitOutcome = 'ready' | 'lost';

export type ServedFile =
  | { kind: 'text'; body: string; contentType: string }
  | { kind: 'file'; path: string; size: number; contentType: string };

function notFound(message: string, hint = 'Start a new playback session.'): AppError {
  return new AppError(404, 'not_found', message, hint);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ffmpeg echoes the input URL (with its token) in many errors; none of that may reach users or logs. */
function scrub(text: string): string {
  return redact(text).replace(/\b(?:https?|ftp):\/\/\S+/gi, '<url>');
}

export class PlaybackManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly probe: ProbeRunner;
  private readonly resolveUrl: UrlResolver;
  private readonly segmentWaitMs: number;
  private readonly maxSessions: number;
  private readonly registry: PidRegistry;
  private readonly monitor: SessionMonitor;
  private timer: NodeJS.Timeout | null = null;
  private starting = 0;
  private libplaceboBroken = false;

  constructor(private readonly options: PlaybackManagerOptions) {
    this.probe = options.probe ?? createFfprobeRunner(options.config.ffprobePath);
    this.resolveUrl = options.resolveUrl ?? createUrlResolver();
    this.segmentWaitMs = options.segmentWaitMs ?? SEGMENT_WAIT_MS;
    this.maxSessions = options.maxSessions ?? MAX_SESSIONS;
    this.registry = new PidRegistry(path.join(options.config.dataDir, PID_FILE_NAME));
    this.monitor = new SessionMonitor(
      {
        liveSessions: () => this.liveRecords(),
        allSessions: () => [...this.sessions.values()].filter((rec) => !rec.stopping),
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
        `The limit of ${this.maxSessions} playback sessions at the same time is reached.`,
        'Stop playback on another device, or wait a couple of minutes for idle sessions to time out, then try again.',
      );
    }
    this.starting += 1;
  }

  private async startSession(body: SessionStartRequest, clientIp: string | null): Promise<SessionResponse> {
    const { config, db, tmdb } = this.options;

    const details = body.mediaType === 'movie' ? await tmdb.movie(body.tmdbId) : await tmdb.show(body.tmdbId);
    const device = upsertDevice(db, body.device, clientIp).capabilities;

    const t0 = Date.now();
    const stream = await this.pickStream(body, details.imdbId, device.deviceId);
    const t1 = Date.now();
    const sourceUrl = await this.resolveUrl(stream.url);
    const t2 = Date.now();
    const probe = await this.probe(sourceUrl);
    const timingsMs = { pickStream: t1 - t0, resolve: t2 - t1, probe: Date.now() - t2 };

    const audio = requireAudio(probe, body.audioIndex);
    const subtitle = requireSubtitle(probe, body.subtitle);

    const decision = decide({ video: probe.video, audio, device, subtitleBurnIn: subtitle?.mode === 'burn' });
    const format = segmentFormatFor(decision.videoCodec);
    const id = randomUUID();
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
      },
      store: new SegmentStore(dir),
      device,
      rawUrl: stream.url,
      sourceUrl,
      probe,
      decision,
      format,
      selectedAudioIndex: audio?.index ?? null,
      selectedSubtitle: subtitle,
      requestedStartSec: body.startPositionSec ?? 0,
      startedAt: now,
      state: 'starting',
      error: null,
      stats: { fps: 0, speed: 0, bitrateKbps: 0, outTimeSec: 0, headSegment: startSegment },
      statSamples: { speedSum: 0, speedCount: 0, bitrateSum: 0, bitrateCount: 0 },
      toneMapper: this.libplaceboBroken ? 'opencl' : 'libplacebo',
      process: null,
      subtitles: null,
      readySubtitles: new Set(),
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

  get(id: string): SessionResponse {
    return toSessionResponse(this.require(id));
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  list(): SessionResponse[] {
    return [...this.sessions.values()].map(toSessionResponse);
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

  /** Records a progress ping: counts as activity, updates the reported position and the playing/paused state. */
  ping(id: string, update: PingUpdate): void {
    const rec = this.require(id);
    const now = Date.now();
    rec.lastActivity = now;
    rec.pingedAt = now;
    rec.positionSec = Math.max(0, update.positionSec);
    rec.playerSegment = Math.floor(rec.positionSec / SEGMENT_SECONDS);
    if (update.state && (rec.state === 'ready' || rec.state === 'playing' || rec.state === 'paused')) {
      rec.state = update.state === 'paused' ? 'paused' : 'playing';
    }
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

  serveSubtitle(id: string, index: number): ServedFile {
    const rec = this.require(id);
    this.touch(id);
    const track = rec.probe.subtitles.find((item) => item.index === index && item.kind === 'text');
    if (!track) throw notFound(`Subtitle track ${index} is not a text track of this session.`, 'Use the url of a text track from the session.');
    if (!rec.readySubtitles.has(index)) {
      throw new AppError(404, 'subtitle_not_ready', `Subtitle track ${index} is still being prepared.`, 'Wait until its url is set in the session, then fetch it.');
    }
    const file = subtitlePath(rec.dir, index);
    return { kind: 'file', path: file, size: statSync(file).size, contentType: 'text/vtt' };
  }

  async monitorTick(): Promise<void> {
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
  }

  async serve(id: string, file: HlsFile): Promise<ServedFile> {
    const rec = this.require(id);
    rec.lastActivity = Date.now();
    const contentType = contentTypeFor(file);

    if (file.kind === 'playlist') {
      return { kind: 'text', body: generatePlaylist(rec.probe.durationSec, rec.format), contentType };
    }
    if (file.kind === 'init') {
      if (rec.format !== 'fmp4') throw notFound('This session has no init segment.', 'MPEG-TS sessions are self-contained.');
      return this.initResponse(rec, contentType);
    }

    const expectedExtension = rec.format === 'fmp4' ? 'm4s' : 'ts';
    if (file.extension !== expectedExtension || file.index >= segmentCount(rec.probe.durationSec)) {
      throw notFound(`Segment ${file.index} does not exist in this session.`, 'Use the segment names listed in index.m3u8.');
    }
    // A track switch replaces the files on disk; nothing from before it may be served.
    while (rec.restart) await rec.restart.catch(() => undefined);
    rec.playerSegment = file.index;
    if (Date.now() - rec.pingedAt > 30_000) rec.positionSec = file.index * SEGMENT_SECONDS;

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
    return { kind: 'file', path: target, size: statSync(target).size, contentType };
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
        throw new AppError(502, 'encoder_failed', rec.error?.message ?? 'The encoder failed.', rec.error?.hint);
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

  private liveRecords(): SessionRecord[] {
    return [...this.sessions.values()].filter((rec) => rec.state !== 'error' && !rec.stopping);
  }

  private ensureTimer(): void {
    const interval = this.options.monitorTickMs ?? MONITOR_TICK_MS;
    if (this.timer || interval <= 0) return;
    this.timer = setInterval(() => {
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

  private async pickStream(body: SessionStartRequest, imdbId: string | null, deviceId: string) {
    const { streams } = this.options;
    let streamId = body.streamId;
    if (streamId === 'auto') {
      if (!imdbId) throw new AppError(404, 'no_streams', 'No streams are available for this title.', 'Try another title.');
      const query =
        body.mediaType === 'movie'
          ? ({ type: 'movie', imdbId } as const)
          : ({ type: 'tv', imdbId, season: body.season as number, episode: body.episode as number } as const);
      const listed = await streams.list(query, deviceId);
      if (!listed.recommendedId) {
        throw new AppError(404, 'no_streams', 'No streams are available for this title.', 'Try another title or check the gateway on the health dashboard.');
      }
      streamId = listed.recommendedId;
    }
    const resolved = await streams.getStreamById(streamId);
    if (!resolved) {
      throw new AppError(404, 'stream_not_found', 'That stream is no longer available.', 'Reload the stream list and pick another stream.');
    }
    return resolved;
  }

  private async titleFor(body: SessionStartRequest, name: string): Promise<{ title: string; showTitle: string | null }> {
    if (body.mediaType === 'movie') return { title: name, showTitle: null };
    const code = `S${String(body.season).padStart(2, '0')}E${String(body.episode).padStart(2, '0')}`;
    try {
      const season = await this.options.tmdb.season(body.tmdbId, body.season as number);
      const episode = season.episodes.find((item) => item.episodeNumber === body.episode);
      return { title: episode?.name || `${name} ${code}`, showTitle: name };
    } catch {
      return { title: `${name} ${code}`, showTitle: name };
    }
  }

  private launch(rec: SessionRecord, startSegment: number): void {
    rec.startSegment = startSegment;
    rec.generation += 1;
    rec.encoderDone = false;
    rec.parked = false;
    rec.store.forget(startSegment);
    rec.stats = { ...rec.stats, headSegment: startSegment, outTimeSec: startSegment * SEGMENT_SECONDS };
    const generation = rec.generation;

    const args = buildFfmpegArgs({
      inputUrl: rec.sourceUrl,
      sessionDir: rec.dir,
      decision: rec.decision,
      video: rec.probe.video,
      audioIndex: rec.selectedAudioIndex,
      startSegment,
      toneMapper: rec.toneMapper,
      burn: burnTarget(rec.probe, rec.selectedSubtitle),
    });
    const proc = new EncoderProcess({
      ffmpegPath: this.options.config.ffmpegPath,
      args,
      cwd: rec.dir,
      onProgress: (progress) => {
        if (rec.generation === generation) this.onProgress(rec, progress);
      },
    });
    rec.process = proc;
    const pid = proc.pid;
    if (pid !== undefined) this.registry.add({ pid, sessionId: rec.id, startedAt: Date.now() });
    void proc.exited.then((exit) => {
      if (pid !== undefined) this.registry.remove(pid);
      if (rec.generation !== generation || rec.stopping) return;
      if (exit.code === 0) {
        rec.encoderDone = true;
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
    this.markReady(rec);
  }

  private markReady(rec: SessionRecord): void {
    if (rec.state === 'starting' && existsSync(path.join(rec.dir, segmentFileName(rec.startSegment, rec.format)))) {
      rec.state = 'ready';
      this.options.bus.emit('session.update', toActivitySession(rec));
      this.startSubtitleExtraction(rec);
    }
  }

  /** Waits for the first segment so the extraction does not compete with it for source bandwidth. */
  private startSubtitleExtraction(rec: SessionRecord): void {
    if (rec.subtitles || rec.stopping) return;
    const indices = rec.probe.subtitles
      .filter((track) => track.kind === 'text')
      .slice(0, MAX_TEXT_SUBTITLES)
      .map((track) => track.index);
    if (indices.length === 0) return;
    rec.subtitles = new SubtitleExtractor({
      ffmpegPath: this.options.config.ffmpegPath,
      sessionId: rec.id,
      sessionDir: rec.dir,
      inputUrl: () => rec.sourceUrl,
      indices,
      registry: this.registry,
      onReady: (index) => rec.readySubtitles.add(index),
      onFailure: (failed, exit) => {
        this.event({
          level: 'warn',
          source: 'ffmpeg',
          message: `Could not extract subtitle track ${failed.join(', ')} to WebVTT; it stays unavailable for this session.`,
          details: { tracks: failed, detail: scrub(exit.stderrTail.split(/\r?\n/).filter(Boolean).at(-1) ?? '') },
          sessionId: rec.id,
        });
      },
    });
    rec.subtitles.start();
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
    try {
      rec.sourceUrl = await this.resolveUrl(rec.rawUrl);
    } catch {
      // keep the previous link; the retry may still work
    }
    if (rec.stopping) return;
    this.launch(rec, this.resumePoint(rec));
  }

  private async fail(rec: SessionRecord, code: number | null, stderrTail: string): Promise<void> {
    const lastLine = scrub(stderrTail.split(/\r?\n/).filter(Boolean).at(-1) ?? '');
    rec.state = 'error';
    rec.error = {
      message: scrub(`The video encoder stopped unexpectedly (code ${code ?? 'none'}). ${lastLine}`.trim()),
      hint: 'Try another stream. If it keeps happening, check the ffmpeg and GPU tiles on the health dashboard.',
    };
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
      ...this.averages(rec),
    });
    this.options.bus.emit('session.update', toActivitySession(rec));
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
        throw new AppError(502, 'encoder_failed', rec.error?.message ?? 'The encoder failed.', rec.error?.hint);
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

  private averages(rec: SessionRecord): { avgBitrateKbps: number | null; avgSpeed: number | null } {
    const { speedSum, speedCount, bitrateSum, bitrateCount } = rec.statSamples;
    return {
      avgBitrateKbps: bitrateCount === 0 ? null : bitrateSum / bitrateCount,
      avgSpeed: speedCount === 0 ? null : speedSum / speedCount,
    };
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
    await rec.restart?.catch(() => undefined);
    await Promise.all([rec.process?.stop(), rec.subtitles?.stop()]);
    await this.removeDir(rec.dir);
    if (!wasError) finalizePlay(this.options.db, rec.id, { endedAt: Date.now(), status: 'ok', ...this.averages(rec) });
    this.options.logger.info({ sessionId: rec.id, reason }, 'Playback session stopped');
    this.options.bus.emit('session.end', { sessionId: rec.id, reason, state: 'stopped' });
  }

  private async removeDir(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch((error: unknown) => {
      this.options.logger.warn({ dir, err: error }, 'Could not delete the session directory');
    });
  }
}
