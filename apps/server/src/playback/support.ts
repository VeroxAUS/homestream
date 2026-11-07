import type { FastifyBaseLogger } from 'fastify';
import type { MovieDetails, PingState, ShowDetails } from '@homestream/shared';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import type { DownloadService } from '../downloads/service.js';
import { AppError } from '../errors.js';
import type { EventBus } from '../events/bus.js';
import { redact } from '../redact.js';
import type { SourceProxy } from '../sourceproxy/proxy.js';
import type { StreamService } from '../streams/service.js';
import type { TmdbService } from '../tmdb/service.js';
import type { EncoderHandle, EncoderProcessOptions } from './encoderProcess.js';
import type { PlaybackObserver, SessionSubject } from './observer.js';
import type { SessionRecord } from './session.js';

/** Polling interval of the waits for files, encoders and subtitle cues. */
export const POLL_MS = 100;

export interface PlaybackManagerOptions {
  config: Config;
  db: Db;
  bus: EventBus;
  logger: FastifyBaseLogger;
  tmdb: TmdbService;
  streams: StreamService;
  /** TorBox caching for titles without a cached stream; without it such a title fails like before (`stream_not_cached`). */
  downloads?: Pick<DownloadService, 'existing' | 'begin'>;
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
  /** Receives session start, end, failure and restart notifications for metrics and analytics. */
  observer?: PlaybackObserver;
}

export interface PingUpdate {
  positionSec: number;
  state?: PingState;
}

export type TitleDetails = Pick<MovieDetails | ShowDetails, 'title' | 'originalLanguage' | 'posterUrl' | 'backdropUrl'>;

export type StopReason = 'stopped' | 'idle' | 'disk' | 'shutdown';
export type WaitOutcome = 'ready' | 'lost';

export type ServedFile =
  | { kind: 'text'; body: string; contentType: string; headers?: Record<string, string> }
  | { kind: 'file'; path: string; size: number; contentType: string };

export function notFound(message: string, hint = 'Start a new playback session.'): AppError {
  return new AppError(404, 'not_found', message, hint);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Errors about the request or the server itself: another stream would fail the same way. */
const NOT_THE_STREAMS_FAULT = new Set([
  'invalid_audio_index',
  'invalid_subtitle_index',
  'subtitle_mode_unsupported',
  'shutting_down',
  'encoder_not_stopped',
]);

export function isStreamFault(error: unknown): boolean {
  return !(error instanceof AppError && NOT_THE_STREAMS_FAULT.has(error.code));
}

/** ffmpeg echoes the input URL (with its token) in many errors; none of that may reach users or logs. */
export function scrub(text: string): string {
  return redact(text).replace(/\b(?:https?|ftp):\/\/\S+/gi, '<url>');
}

export function subjectOf(rec: SessionRecord): SessionSubject {
  const { meta } = rec;
  return {
    mediaType: meta.mediaType,
    tmdbId: meta.tmdbId,
    title: meta.showTitle ?? meta.title,
    season: meta.season,
    episode: meta.episode,
    deviceKind: rec.device.kind,
  };
}

export function endStats(rec: SessionRecord): {
  avgBitrateKbps: number | null;
  avgSpeed: number | null;
  bytesServed: number;
} {
  const { speedSum, speedCount, bitrateSum, bitrateCount } = rec.statSamples;
  return {
    avgBitrateKbps: bitrateCount === 0 ? null : bitrateSum / bitrateCount,
    avgSpeed: speedCount === 0 ? null : speedSum / speedCount,
    bytesServed: rec.bytesServed,
  };
}
