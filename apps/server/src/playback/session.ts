import type {
  ActivitySession,
  CapabilityProfile,
  Decision,
  EncoderStats,
  SessionResponse,
  SessionState,
  StartAttempt,
  SubtitleSelection,
  SubtitleTrack,
} from '@homestream/shared';
import type { EncoderHandle } from './encoderProcess.js';
import type { ToneMapper } from './ffmpegArgs.js';
import type { ProbeResult } from './probe.js';
import type { SegmentFormat } from './playlist.js';
import type { SegmentStore } from './segmentStore.js';
import { selectTextTracks, type SubtitleExtractor } from './subtitleExtractor.js';
import type { SourceHandle } from '../sourceproxy/proxy.js';

export interface SessionMeta {
  mediaKey: string;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  showTitle: string | null;
  season: number | null;
  episode: number | null;
  streamFilename: string;
  clientIp: string | null;
}

export interface StatSamples {
  speedSum: number;
  speedCount: number;
  bitrateSum: number;
  bitrateCount: number;
}

export interface SessionRecord {
  id: string;
  dir: string;
  meta: SessionMeta;
  store: SegmentStore;
  device: CapabilityProfile;
  /** The source proxy entry every ffprobe/ffmpeg of this session reads from; holds the CDN link, which never leaves it. */
  source: SourceHandle;
  probe: ProbeResult;
  decision: Decision;
  format: SegmentFormat;
  selectedAudioIndex: number | null;
  selectedSubtitle: SubtitleSelection | null;
  requestedStartSec: number;
  startedAt: number;
  /** Id of the gateway stream that plays, and the ones an automatic start gave up on before it. */
  streamId: string;
  attempts: StartAttempt[];
  /** True from the encoder launch until its first segment exists; an opening session is invisible to clients and can still be thrown away. */
  opening: boolean;

  state: SessionState;
  error: { message: string; hint?: string } | null;
  /** Error code for API errors while the session is failed; null means encoder_failed. */
  errorCode: string | null;
  stats: EncoderStats;
  statSamples: StatSamples;
  toneMapper: ToneMapper;

  process: EncoderHandle | null;
  /** Progressive WebVTT extraction and cue store of the text tracks; null when the file has none. Independent of encoder restarts. */
  subtitles: SubtitleExtractor | null;
  /** First segment of the current ffmpeg run. */
  startSegment: number;
  generation: number;
  /** Run whose init.mp4 the served init-ready.mp4 was copied from. */
  retried: boolean;
  encoderDone: boolean;
  stopping: boolean;
  restart: Promise<void> | null;
  /** Encoder stopped on purpose (disk cap) with its output kept; restarts when the player catches up. */
  parked: boolean;
  /** Last time the client did something that counts as activity: playlist, segment, subtitle or progress ping. */
  lastActivity: number;
  /** Position reported by the player's progress pings, and when it was reported. */
  positionSec: number;
  pingedAt: number;
  /** Segment the player requested last. */
  playerSegment: number;
}

export function toActivitySession(rec: SessionRecord): ActivitySession {
  return {
    sessionId: rec.id,
    mediaKey: rec.meta.mediaKey,
    mediaType: rec.meta.mediaType,
    tmdbId: rec.meta.tmdbId,
    title: rec.meta.title,
    showTitle: rec.meta.showTitle,
    season: rec.meta.season,
    episode: rec.meta.episode,
    deviceId: rec.device.deviceId,
    deviceName: rec.device.deviceName,
    deviceKind: rec.device.kind,
    clientIp: rec.meta.clientIp,
    streamFilename: rec.meta.streamFilename,
    startedAt: rec.startedAt,
    positionSec: Math.min(rec.positionSec, rec.probe.durationSec),
    durationSec: rec.probe.durationSec,
    state: rec.state,
    decision: rec.decision,
    encoder: rec.stats,
    error: rec.error,
  };
}

/** Bitmap tracks plus the text tracks that have a rendition (the cap drops the rest); original order. */
function subtitleTracksOf(rec: SessionRecord): SubtitleTrack[] {
  const rendered = new Set(selectTextTracks(rec.probe).map((track) => track.index));
  const status = rec.subtitles?.store.status() ?? 'error';
  const complete = status === 'complete';
  const tracks: SubtitleTrack[] = [];
  for (const { codec: _codec, canvas: _canvas, ...track } of rec.probe.subtitles) {
    if (track.kind === 'bitmap') {
      tracks.push({ ...track, url: null });
    } else if (rendered.has(track.index)) {
      tracks.push({
        ...track,
        url: `/hls/${rec.id}/subs/${track.index}/index.m3u8`,
        fullUrl: complete ? `/hls/${rec.id}/subs/${track.index}.vtt` : null,
        status,
      });
    }
  }
  return tracks;
}

export function toSessionResponse(rec: SessionRecord): SessionResponse {
  return {
    sessionId: rec.id,
    playlistUrl: `/hls/${rec.id}/index.m3u8`,
    mediaPlaylistUrl: `/hls/${rec.id}/video.m3u8`,
    durationSec: rec.probe.durationSec,
    startPositionSec: rec.requestedStartSec,
    state: rec.state,
    decision: rec.decision,
    audioTracks: rec.probe.audio,
    subtitleTracks: subtitleTracksOf(rec),
    selectedAudioIndex: rec.selectedAudioIndex,
    selectedSubtitle: rec.selectedSubtitle,
    streamId: rec.streamId,
    attempts: rec.attempts,
    encoder: rec.stats,
    error: rec.error,
  };
}
