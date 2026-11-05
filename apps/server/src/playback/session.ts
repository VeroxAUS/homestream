import type {
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

export interface SessionRecord {
  id: string;
  dir: string;
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
  statSamples: { speedSum: number; bitrateSum: number; count: number };
  toneMapper: ToneMapper;

  process: EncoderProcess | null;
  /** First segment of the current ffmpeg run. */
  startSegment: number;
  generation: number;
  retried: boolean;
  encoderDone: boolean;
  stopping: boolean;
  restart: Promise<void> | null;
  lastActivity: number;
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
    subtitleTracks: rec.probe.subtitles.map(({ codec: _codec, ...track }) => ({ ...track, url: null })),
    selectedAudioIndex: rec.selectedAudioIndex,
    selectedSubtitle: rec.selectedSubtitle,
    encoder: rec.stats,
    error: rec.error,
  };
}
