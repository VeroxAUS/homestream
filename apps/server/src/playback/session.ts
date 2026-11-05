import type {
  ActivitySession,
  CapabilityProfile,
  Decision,
  EncoderStats,
  SessionResponse,
  SessionState,
  SubtitleSelection,
} from '@homestream/shared';
import type { EncoderProcess } from './encoderProcess.js';
import type { ToneMapper } from './ffmpegArgs.js';
import type { ProbeResult } from './probe.js';
import type { SegmentFormat } from './playlist.js';
import type { SegmentStore } from './segmentStore.js';
import type { SubtitleExtractor } from './subtitleExtractor.js';

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
  /** Gateway link; server-side only. */
  rawUrl: string;
  /** Resolved TorBox CDN URL; server-side only. */
  sourceUrl: string;
  probe: ProbeResult;
  decision: Decision;
  format: SegmentFormat;
  selectedAudioIndex: number | null;
  selectedSubtitle: SubtitleSelection | null;
  requestedStartSec: number;
  startedAt: number;

  state: SessionState;
  error: { message: string; hint?: string } | null;
  stats: EncoderStats;
  statSamples: StatSamples;
  toneMapper: ToneMapper;

  process: EncoderProcess | null;
  /** Background WebVTT extraction of the text tracks; started once the first segment exists. */
  subtitles: SubtitleExtractor | null;
  /** Text tracks whose WebVTT file is complete and servable. */
  readySubtitles: Set<number>;
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

export function toSessionResponse(rec: SessionRecord): SessionResponse {
  return {
    sessionId: rec.id,
    playlistUrl: `/hls/${rec.id}/index.m3u8`,
    durationSec: rec.probe.durationSec,
    startPositionSec: rec.requestedStartSec,
    state: rec.state,
    decision: rec.decision,
    audioTracks: rec.probe.audio,
    subtitleTracks: rec.probe.subtitles.map(({ codec: _codec, canvas: _canvas, ...track }) => ({
      ...track,
      url: rec.readySubtitles.has(track.index) ? `/hls/${rec.id}/subs/${track.index}.vtt` : null,
    })),
    selectedAudioIndex: rec.selectedAudioIndex,
    selectedSubtitle: rec.selectedSubtitle,
    encoder: rec.stats,
    error: rec.error,
  };
}
