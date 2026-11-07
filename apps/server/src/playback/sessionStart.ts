import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  CapabilityProfile,
  DownloadStartedResponse,
  SessionResponse,
  SessionStartRequest,
  StartAttempt,
} from '@homestream/shared';
import { upsertDevice } from '../db/devices.js';
import { insertPlay } from '../db/plays.js';
import type { BeginResult } from '../downloads/service.js';
import { AllStreamsFailedError, AppError } from '../errors.js';
import type { SourceHandle } from '../sourceproxy/proxy.js';
import { deviceMaxRank, startCandidates } from '../streams/rank.js';
import type { ResolvedStream } from '../streams/service.js';
import type { PlaybackContext } from './context.js';
import { chooseDefaultSubtitle } from './defaultSubtitle.js';
import { decide } from './decision.js';
import type { EncoderLifecycle } from './encoderLifecycle.js';
import { clipSizeImplausible, placeholderError } from './placeholder.js';
import { SEGMENT_SECONDS, segmentCount, segmentFileName, segmentFormatFor } from './playlist.js';
import { createSessionRecord, playStartOf } from './sessionRecord.js';
import { toActivitySession, toSessionResponse, type SessionRecord } from './session.js';
import { StartTimeline } from './startTimeline.js';
import { selectTextTracks } from './subtitleExtractor.js';
import type { SubtitleHandoff } from './subtitleHandoff.js';
import { isStreamFault, scrub, sleep, subjectOf, type TitleDetails } from './support.js';
import { requireAudio, requireSubtitle } from './tracks.js';

/** Candidates an automatic start tries before it gives up. */
const MAX_START_ATTEMPTS = 3;
const FIRST_SEGMENT_POLL_MS = 25;

interface AttemptContext {
  streamId: string;
  device: CapabilityProfile;
  details: TitleDetails;
  attempts: StartAttempt[];
  timeline: StartTimeline;
  /** Where the stream's link already led, when the downloads probe followed it (spares a second gateway request). */
  resolvedUrl?: string;
}

interface SourceContext extends Omit<AttemptContext, 'streamId' | 'resolvedUrl'> {
  id: string;
  stream: ResolvedStream;
  source: SourceHandle;
  timings: { t0: number; t1: number };
}

export interface StarterHooks {
  /** Called once a session is registered, so the housekeeping timer runs while sessions exist. */
  sessionAdded(): void;
}

/** Everything between a start request and the first playable segment: plan, resolve, probe, launch, wait. */
export class SessionStarter {
  constructor(
    private readonly ctx: PlaybackContext,
    private readonly encoder: EncoderLifecycle,
    private readonly subtitles: SubtitleHandoff,
    private readonly hooks: StarterHooks,
  ) {}

  /** Resolves to a session (201) or, for a title TorBox has to cache first, to the tracked download (202). */
  async start(body: SessionStartRequest, clientIp: string | null): Promise<SessionResponse | DownloadStartedResponse> {
    const timeline = new StartTimeline(this.ctx.options.logger);
    if (body.streamId === 'auto') {
      // A repeat Play needs no session slot, gateway lookup or TMDB call.
      const pending = this.ctx.options.downloads?.existing(body);
      if (pending) return pending;
    }
    this.ctx.slots.reserve();
    try {
      return await this.startSession(body, clientIp, timeline);
    } catch (error) {
      this.reportStartFailure(body, error);
      throw error;
    } finally {
      this.ctx.slots.endReservation();
    }
  }

  /** A shutdown is not a failed start (a refused slot throws before this runs); everything else is reported with its error code. */
  private reportStartFailure(body: SessionStartRequest, error: unknown): void {
    const code = error instanceof AppError ? error.code : 'start_failed';
    if (code === 'shutting_down') return;
    this.ctx.options.observer?.failed(
      {
        mediaType: body.mediaType,
        tmdbId: body.tmdbId,
        title: null,
        season: body.season ?? null,
        episode: body.episode ?? null,
        deviceKind: body.device.kind,
      },
      { stage: 'start', code },
    );
  }

  private async startSession(
    body: SessionStartRequest,
    clientIp: string | null,
    timeline: StartTimeline,
  ): Promise<SessionResponse | DownloadStartedResponse> {
    const { db, tmdb } = this.ctx.options;

    const details = body.mediaType === 'movie' ? await tmdb.movie(body.tmdbId) : await tmdb.show(body.tmdbId);
    const device = upsertDevice(db, body.device, clientIp).capabilities;

    const plan = await this.planStart(body, details.imdbId, device);
    const begun = await this.beginDownload(body, details, plan);
    if (begun?.status === 'downloading') return begun;
    const attempts: StartAttempt[] = [];
    for (const streamId of plan.streamIds) {
      try {
        const resolvedUrl = begun?.streamId === streamId ? begun.target : undefined;
        return await this.attemptStart(body, clientIp, { streamId, device, details, attempts, timeline, resolvedUrl });
      } catch (error) {
        this.noteFailedAttempt(error, streamId, plan, attempts);
      }
    }
    throw new AllStreamsFailedError(attempts);
  }

  /** Records a failed candidate and returns when the next one may be tried; rethrows when no other stream could do better. */
  private noteFailedAttempt(
    error: unknown,
    streamId: string,
    plan: { streamIds: string[]; auto: boolean; cached: boolean },
    attempts: StartAttempt[],
  ): void {
    // An explicit stream id gets one try, and a refused request or a shutdown is not the stream's fault.
    if (!plan.auto || !isStreamFault(error)) throw error;
    const code = error instanceof AppError ? error.code : 'start_failed';
    attempts.push({ streamId, code });
    this.ctx.event({
      level: 'warn',
      source: 'session',
      message: `Stream ${attempts.length} of ${plan.streamIds.length} could not be started (${code}); ${attempts.length < plan.streamIds.length ? 'trying the next one' : 'no more candidates'}.`,
      details: { streamId, code, detail: scrub(error instanceof Error ? error.message : String(error)) },
    });
    // An uncached title has a single candidate; its own error (for example "not cached yet") says more than a list of failures.
    if (!plan.cached) throw error;
  }

  /**
   * The chosen stream is not cached (the best-ranked one of an automatic start, or the explicit id the client sent):
   * TorBox is asked to cache it instead of playing whatever the gateway answers. A link that turns out to be playable
   * comes back with the target the probe followed, so the start continues from it.
   */
  private async beginDownload(
    body: SessionStartRequest,
    details: { title: string; imdbId: string | null },
    plan: { streamIds: string[]; auto: boolean; cached: boolean },
  ): Promise<BeginResult> {
    const { downloads } = this.ctx.options;
    if (plan.cached) return null;
    if (!downloads || !details.imdbId) {
      // An explicit uncached id has no other way to be handled, and playing it would play the gateway's clip.
      if (!plan.auto) throw placeholderError('downloading');
      return null;
    }
    return downloads.begin({
      body,
      title: details.title,
      imdbId: details.imdbId,
      streamId: plan.streamIds[0] as string,
    });
  }

  /** The stream ids an automatic start tries in order (the best-ranked cached streams that fit the device), or the one explicit id. */
  private async planStart(
    body: SessionStartRequest,
    imdbId: string | null,
    device: CapabilityProfile,
  ): Promise<{ streamIds: string[]; auto: boolean; cached: boolean }> {
    const { streams } = this.ctx.options;
    if (body.streamId !== 'auto') {
      // An unknown id is reported by the attempt itself.
      const chosen = await streams.getStreamById(body.streamId);
      return { streamIds: [body.streamId], auto: false, cached: chosen?.stream.cached ?? true };
    }
    if (!imdbId)
      throw new AppError(404, 'no_streams', 'No streams are available for this title.', 'Try another title.');
    const query =
      body.mediaType === 'movie'
        ? ({ type: 'movie', imdbId } as const)
        : ({ type: 'tv', imdbId, season: body.season as number, episode: body.episode as number } as const);
    const listed = await streams.list(query, device.deviceId);
    const picked = startCandidates(listed.streams, deviceMaxRank(device), MAX_START_ATTEMPTS);
    if (picked.streams.length === 0) {
      throw new AppError(
        404,
        'no_streams',
        'No streams are available for this title.',
        'Try another title or check the gateway on the health dashboard.',
      );
    }
    return { streamIds: picked.streams.map((stream) => stream.id), auto: true, cached: picked.cached };
  }

  /** One candidate: resolve, probe, start the encoder and wait for its first segment. Leaves nothing behind when it fails. */
  private async attemptStart(
    body: SessionStartRequest,
    clientIp: string | null,
    context: AttemptContext,
  ): Promise<SessionResponse> {
    const { streams, proxy } = this.ctx.options;
    const id = randomUUID();
    const timeline = context.timeline.nextAttempt();
    const t0 = Date.now();
    const stream = await streams.getStreamById(context.streamId);
    if (!stream) {
      throw new AppError(
        404,
        'stream_not_found',
        'That stream is no longer available.',
        'Use streamId "auto", or list the streams again to get current ids.',
      );
    }
    const t1 = Date.now();
    timeline.mark('stream picked', id);
    // A prefetch of the same stream has already resolved the link, warmed the proxy and run ffprobe.
    const source = await proxy.acquire(stream.url, id, context.resolvedUrl);
    timeline.mark('source acquired', id);
    void source.headReady.then(() => timeline.mark('head fill done', id));
    try {
      // The gateway can serve its "downloading" clip as a plain file; against the listed size it stands out.
      if (!stream.stream.cached && clipSizeImplausible(stream.stream.sizeBytes, source.sizeBytes)) {
        throw placeholderError('downloading');
      }
      return await this.startWithSource(body, clientIp, {
        ...context,
        id,
        stream,
        source,
        timings: { t0, t1 },
        timeline,
      });
    } catch (error) {
      source.release();
      throw error;
    }
  }

  private async startWithSource(
    body: SessionStartRequest,
    clientIp: string | null,
    context: SourceContext,
  ): Promise<SessionResponse> {
    const { options, slots } = this.ctx;
    const { id, stream, source, device, details } = context;
    const t2 = Date.now();
    const probe = await source.probe();
    context.timeline.mark('probe done', id);
    const timingsMs = {
      pickStream: context.timings.t1 - context.timings.t0,
      source: t2 - context.timings.t1,
      probe: Date.now() - t2,
    };

    const audio = requireAudio(probe, body.audioIndex);
    const automatic =
      body.subtitle === undefined ? chooseDefaultSubtitle(probe.subtitles, audio, details.originalLanguage) : null;
    const subtitle = automatic ? automatic.selection : requireSubtitle(probe, body.subtitle);
    const decision = decide({ video: probe.video, audio, device, subtitleBurnIn: subtitle?.mode === 'burn' });
    const format = segmentFormatFor(decision.videoCodec);
    const startSegment = Math.min(
      segmentCount(probe.durationSec) - 1,
      Math.floor((body.startPositionSec ?? 0) / SEGMENT_SECONDS),
    );
    const title = await this.titleFor(body, details.title);
    const rec = createSessionRecord({
      id,
      dir: path.join(options.config.transcodeDir, id),
      body,
      clientIp,
      stream,
      source,
      device,
      details,
      title,
      probe,
      decision,
      format,
      audio,
      subtitle,
      automatic,
      textTracks: selectTextTracks(probe, subtitle?.mode === 'sidecar' ? subtitle.index : null),
      startSegment,
      attempts: context.attempts,
      timeline: context.timeline,
      toneMapper: this.ctx.libplaceboBroken ? 'opencl' : 'libplacebo',
      now: Date.now(),
    });

    await mkdir(rec.dir, { recursive: true });
    try {
      insertPlay(options.db, playStartOf(rec));
    } catch (error) {
      await this.ctx.removeDir(rec.dir);
      throw error;
    }

    slots.add(rec);
    this.hooks.sessionAdded();
    this.encoder.launch(rec, startSegment);
    this.subtitles.start(rec);
    const tFirst = Date.now();
    try {
      await this.waitForFirstSegment(rec);
    } catch (error) {
      await slots.abandon(rec);
      throw error;
    }
    rec.opening = false;
    rec.startTimeline = null;
    rec.pingClock = Date.now();
    Object.assign(timingsMs, { firstSegment: Date.now() - tFirst });
    this.announceStarted(rec, timingsMs, context.timeline.elapsedMs());
    return toSessionResponse(rec);
  }

  private announceStarted(rec: SessionRecord, timingsMs: Record<string, number>, startupMs: number): void {
    const { options } = this.ctx;
    const { decision, device } = rec;
    const { title, showTitle } = rec.meta;
    options.logger.info({ sessionId: rec.id, decision, timingsMs }, 'Playback session started');
    this.ctx.event({
      level: 'info',
      source: 'session',
      message: `Playback started: ${showTitle ? `${showTitle} - ` : ''}${title} on ${device.deviceName}.`,
      details: { decision, timingsMs },
      sessionId: rec.id,
    });
    options.bus.emit('session.start', toActivitySession(rec));
    options.observer?.started(subjectOf(rec), { startupMs, decision });
  }

  private async titleFor(
    body: SessionStartRequest,
    name: string,
  ): Promise<{ title: string; showTitle: string | null; stillUrl: string | null }> {
    if (body.mediaType === 'movie') return { title: name, showTitle: null, stillUrl: null };
    const code = `S${String(body.season).padStart(2, '0')}E${String(body.episode).padStart(2, '0')}`;
    try {
      const season = await this.ctx.options.tmdb.season(body.tmdbId, body.season as number);
      const episode = season.episodes.find((item) => item.episodeNumber === body.episode);
      return { title: episode?.name || `${name} ${code}`, showTitle: name, stillUrl: episode?.stillUrl ?? null };
    } catch {
      return { title: `${name} ${code}`, showTitle: name, stillUrl: null };
    }
  }

  /**
   * Waits until the first segment of the new session exists, so a start that cannot produce video fails here instead of
   * after the client has been told it works. The encoder's own retry runs inside this wait.
   */
  private async waitForFirstSegment(rec: SessionRecord): Promise<void> {
    const first = path.join(rec.dir, segmentFileName(rec.startSegment, rec.format));
    const deadline = Date.now() + this.ctx.firstSegmentWaitMs;
    for (;;) {
      if (existsSync(first)) {
        rec.startTimeline?.mark('first segment written', rec.id);
        this.encoder.markReady(rec);
        return;
      }
      if (rec.stopping)
        throw new AppError(503, 'shutting_down', 'The server is shutting down.', 'Try again in a moment.');
      if (rec.state === 'error') {
        throw new AppError(
          502,
          rec.errorCode ?? 'encoder_failed',
          rec.error?.message ?? 'The encoder failed.',
          rec.error?.hint,
        );
      }
      if (rec.encoderDone && !rec.process?.running) {
        throw new AppError(
          502,
          'encoder_failed',
          'The encoder finished without producing any video.',
          'Try again in a moment.',
        );
      }
      if (Date.now() >= deadline) {
        throw new AppError(
          504,
          'encoder_timeout',
          `The encoder produced no video within ${Math.round(this.ctx.firstSegmentWaitMs / 1000)} seconds.`,
          'The source may be slow or the encoder stuck; try again, or check the health dashboard.',
        );
      }
      await sleep(FIRST_SEGMENT_POLL_MS);
    }
  }
}
