import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { SessionResponse, SessionStartRequest } from '@homestream/shared';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { upsertDevice } from '../db/devices.js';
import { finalizePlay, insertPlay, mediaKeyFor } from '../db/plays.js';
import { AppError } from '../errors.js';
import { redact } from '../redact.js';
import type { StreamService } from '../streams/service.js';
import type { TmdbService } from '../tmdb/service.js';
import { decide, selectAudioTrack } from './decision.js';
import { EncoderProcess } from './encoderProcess.js';
import { buildFfmpegArgs } from './ffmpegArgs.js';
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
import { toSessionResponse, type SessionRecord } from './session.js';

export const SEGMENT_WAIT_MS = 30_000;
/** A segment further ahead of the encoder than this triggers a restart at the requested position. */
export const SEEK_WINDOW_SEGMENTS = 5;
const POLL_MS = 100;

export interface PlaybackManagerOptions {
  config: Config;
  db: Db;
  logger: FastifyBaseLogger;
  tmdb: TmdbService;
  streams: StreamService;
  probe?: ProbeRunner;
  resolveUrl?: UrlResolver;
  segmentWaitMs?: number;
}

export type ServedFile =
  | { kind: 'text'; body: string; contentType: string }
  | { kind: 'file'; path: string; size: number; contentType: string };

function notFound(message: string, hint = 'Start a new playback session.'): AppError {
  return new AppError(404, 'not_found', message, hint);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PlaybackManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly probe: ProbeRunner;
  private readonly resolveUrl: UrlResolver;
  private readonly segmentWaitMs: number;
  private libplaceboBroken = false;

  constructor(private readonly options: PlaybackManagerOptions) {
    this.probe = options.probe ?? createFfprobeRunner(options.config.ffprobePath);
    this.resolveUrl = options.resolveUrl ?? createUrlResolver();
    this.segmentWaitMs = options.segmentWaitMs ?? SEGMENT_WAIT_MS;
  }

  async start(body: SessionStartRequest, clientIp: string | null): Promise<SessionResponse> {
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

    const audio = selectAudioTrack(probe.audio, body.audioIndex);
    if (body.audioIndex !== undefined && !audio) {
      throw new AppError(400, 'invalid_audio_index', `The file has no audio track ${body.audioIndex}.`, 'Pick one of the audioTracks of this file.');
    }
    if (body.subtitle && !probe.subtitles.some((track) => track.index === body.subtitle?.index)) {
      throw new AppError(400, 'invalid_subtitle_index', `The file has no subtitle track ${body.subtitle.index}.`, 'Pick one of the subtitleTracks of this file.');
    }

    const decision = decide({ video: probe.video, audio, device });
    const format = segmentFormatFor(decision.videoCodec);
    const id = randomUUID();
    const dir = path.join(config.transcodeDir, id);
    const total = segmentCount(probe.durationSec);
    const startSegment = Math.min(total - 1, Math.floor((body.startPositionSec ?? 0) / SEGMENT_SECONDS));

    const title = await this.titleFor(body, details.title);
    const now = Date.now();
    const rec: SessionRecord = {
      id,
      dir,
      device,
      rawUrl: stream.url,
      sourceUrl,
      probe,
      decision,
      format,
      selectedAudioIndex: audio?.index ?? null,
      selectedSubtitle: body.subtitle ?? null,
      requestedStartSec: body.startPositionSec ?? 0,
      startedAt: now,
      state: 'starting',
      error: null,
      stats: { fps: 0, speed: 0, bitrateKbps: 0, outTimeSec: 0, headSegment: startSegment },
      statSamples: { speedSum: 0, bitrateSum: 0, count: 0 },
      toneMapper: this.libplaceboBroken ? 'opencl' : 'libplacebo',
      process: null,
      startSegment,
      generation: 0,
      retried: false,
      encoderDone: false,
      stopping: false,
      restart: null,
      lastActivity: now,
    };

    await mkdir(dir, { recursive: true });
    try {
      insertPlay(db, {
        sessionId: id,
        mediaKey: mediaKeyFor(body.mediaType, body.tmdbId, body.season, body.episode),
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
    this.launch(rec, startSegment);
    this.options.logger.info({ sessionId: id, decision, timingsMs }, 'Playback session started');
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

  async stop(id: string): Promise<void> {
    await this.end(this.require(id));
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((rec) => this.end(rec)));
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
    const target = path.join(rec.dir, segmentFileName(file.index, rec.format));
    if (!existsSync(target)) await this.ensureEncoder(rec, file.index);
    return this.fileResponse(rec, target, contentType, file.index);
  }

  private async fileResponse(rec: SessionRecord, target: string, contentType: string, segment: number): Promise<ServedFile> {
    await this.waitForFile(rec, target, segment);
    this.markReady(rec);
    return { kind: 'file', path: target, size: statSync(target).size, contentType };
  }

  /**
   * ffmpeg creates init.mp4 early but only finishes it together with the first segment, and a restart rewrites it.
   * A copy taken once a segment exists is stable and identical for every run of the session.
   */
  private async initResponse(rec: SessionRecord, contentType: string): Promise<ServedFile> {
    const ready = path.join(rec.dir, 'init-ready.mp4');
    if (!existsSync(ready)) {
      await this.waitForFile(rec, path.join(rec.dir, segmentFileName(rec.startSegment, rec.format)), rec.startSegment);
      const temp = path.join(rec.dir, `init-${randomUUID()}.tmp`);
      await copyFile(path.join(rec.dir, 'init.mp4'), temp);
      await rename(temp, ready);
    }
    return { kind: 'file', path: ready, size: statSync(ready).size, contentType };
  }

  private require(id: string): SessionRecord {
    const rec = this.sessions.get(id);
    if (!rec) throw notFound(`Session ${id.slice(0, 64)} was not found.`);
    return rec;
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
    rec.stats = { ...rec.stats, headSegment: startSegment };
    const generation = rec.generation;

    const args = buildFfmpegArgs({
      inputUrl: rec.sourceUrl,
      sessionDir: rec.dir,
      decision: rec.decision,
      video: rec.probe.video,
      audioIndex: rec.selectedAudioIndex,
      startSegment,
      toneMapper: rec.toneMapper,
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
    void proc.exited.then((exit) => {
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
    rec.stats = { ...progress, outTimeSec: progress.outTimeSec + rec.startSegment * SEGMENT_SECONDS, headSegment: head };
    if (progress.speed > 0) {
      rec.statSamples.speedSum += progress.speed;
      rec.statSamples.bitrateSum += progress.bitrateKbps;
      rec.statSamples.count += 1;
    }
    this.markReady(rec);
  }

  private markReady(rec: SessionRecord): void {
    if (rec.state === 'starting' && existsSync(path.join(rec.dir, segmentFileName(rec.startSegment, rec.format)))) {
      rec.state = 'ready';
    }
  }

  /** First failure: re-resolve the CDN link (and fall back from libplacebo) and carry on. Second failure ends the session. */
  private async recover(rec: SessionRecord, code: number | null, stderrTail: string): Promise<void> {
    if (rec.retried) {
      await this.fail(rec, code, stderrTail);
      return;
    }
    rec.retried = true;
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
    this.launch(rec, this.nextMissingSegment(rec));
  }

  private async fail(rec: SessionRecord, code: number | null, stderrTail: string): Promise<void> {
    const lastLine = stderrTail.split(/\r?\n/).filter(Boolean).at(-1) ?? '';
    rec.state = 'error';
    rec.error = {
      message: redact(`The video encoder stopped unexpectedly (code ${code ?? 'none'}). ${lastLine}`.trim()),
      hint: 'Try another stream. If it keeps happening, check the ffmpeg and GPU tiles on the health dashboard.',
    };
    this.options.logger.error({ sessionId: rec.id, code, detail: lastLine }, 'ffmpeg failed');
    finalizePlay(this.options.db, rec.id, {
      endedAt: Date.now(),
      status: 'error',
      errorMessage: rec.error.message,
      ...this.averages(rec),
    });
  }

  private hasSegment(rec: SessionRecord, index: number): boolean {
    return existsSync(path.join(rec.dir, segmentFileName(index, rec.format)));
  }

  private nextMissingSegment(rec: SessionRecord): number {
    let index = rec.startSegment;
    while (this.hasSegment(rec, index)) index += 1;
    return Math.min(index, segmentCount(rec.probe.durationSec) - 1);
  }

  private isDead(rec: SessionRecord): boolean {
    return rec.state === 'error' || rec.stopping;
  }

  private inWindow(rec: SessionRecord, index: number): boolean {
    return !!rec.process?.running && index >= rec.startSegment && index <= rec.stats.headSegment + SEEK_WINDOW_SEGMENTS;
  }

  private async ensureEncoder(rec: SessionRecord, index: number): Promise<void> {
    if (this.isDead(rec)) return;
    if (rec.restart) await rec.restart;
    if (this.isDead(rec) || this.inWindow(rec, index)) return;
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

  private async waitForFile(rec: SessionRecord, target: string, segment: number): Promise<void> {
    const deadline = Date.now() + this.segmentWaitMs;
    for (;;) {
      if (existsSync(target)) return;
      if (rec.stopping) throw notFound('This session has ended.');
      if (rec.state === 'error') {
        throw new AppError(502, 'encoder_failed', rec.error?.message ?? 'The encoder failed.', rec.error?.hint);
      }
      if (rec.encoderDone && !rec.process?.running) {
        throw notFound(`Segment ${segment} was not produced.`, 'Seek again or restart playback.');
      }
      if (Date.now() >= deadline) {
        throw new AppError(504, 'segment_timeout', `Segment ${segment} was not ready in time.`, 'The encoder is behind; try again, or check the health dashboard.');
      }
      await sleep(POLL_MS);
    }
  }

  private averages(rec: SessionRecord): { avgBitrateKbps: number | null; avgSpeed: number | null } {
    const { speedSum, bitrateSum, count } = rec.statSamples;
    return count === 0 ? { avgBitrateKbps: null, avgSpeed: null } : { avgBitrateKbps: bitrateSum / count, avgSpeed: speedSum / count };
  }

  private async end(rec: SessionRecord): Promise<void> {
    if (rec.stopping) return;
    rec.stopping = true;
    const wasError = rec.state === 'error';
    rec.state = 'stopped';
    this.sessions.delete(rec.id);
    await rec.restart?.catch(() => undefined);
    await rec.process?.stop();
    await this.removeDir(rec.dir);
    if (!wasError) finalizePlay(this.options.db, rec.id, { endedAt: Date.now(), status: 'ok', ...this.averages(rec) });
    this.options.logger.info({ sessionId: rec.id }, 'Playback session stopped');
  }

  private async removeDir(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch((error: unknown) => {
      this.options.logger.warn({ dir, err: error }, 'Could not delete the session directory');
    });
  }
}
