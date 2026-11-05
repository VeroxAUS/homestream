import { execFile } from 'node:child_process';
import type { AudioTrack, SourceHdr, SubtitleTrack } from '@homestream/shared';
import { AppError } from '../errors.js';
import { redact } from '../redact.js';
import { lowerPriority } from './priority.js';

export interface VideoInfo {
  index: number;
  codec: string;
  profile: string;
  width: number;
  height: number;
  pixFmt: string;
  fps: number;
  hdr: SourceHdr;
  dolbyVisionProfile: number | null;
}

export type SubtitleTrackInfo = Omit<SubtitleTrack, 'url' | 'fullUrl' | 'status'> & {
  codec: string;
  /** Canvas the bitmap was authored for; absent when the container does not say. */
  canvas?: { width: number; height: number };
};

export interface ProbeResult {
  durationSec: number;
  video: VideoInfo;
  audio: AudioTrack[];
  subtitles: SubtitleTrackInfo[];
}

interface RawStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  channels?: number;
  color_transfer?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  tags?: Record<string, string>;
  disposition?: Record<string, number>;
  side_data_list?: Array<Record<string, unknown>>;
}

interface RawProbe {
  streams?: RawStream[];
  format?: { duration?: string };
}

const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);
const BITMAP_SUBTITLE_CODECS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub']);
const COVER_ART_CODECS = new Set(['mjpeg', 'png', 'bmp', 'gif']);

const DEFAULT_FPS = 24;

function tag(stream: RawStream, name: string): string {
  const tags = stream.tags ?? {};
  const key = Object.keys(tags).find((candidate) => candidate.toLowerCase() === name);
  return key ? (tags[key] ?? '').trim() : '';
}

function parseRate(rate: string | undefined): number {
  const [num, den] = (rate ?? '').split('/').map(Number);
  if (!num || !den) return 0;
  return num / den;
}

function frameRate(stream: RawStream): number {
  for (const candidate of [parseRate(stream.avg_frame_rate), parseRate(stream.r_frame_rate)]) {
    if (candidate >= 5 && candidate <= 121) return candidate;
  }
  return DEFAULT_FPS;
}

function dolbyVisionProfile(stream: RawStream): number | null {
  for (const item of stream.side_data_list ?? []) {
    if (typeof item.side_data_type === 'string' && item.side_data_type.toLowerCase().includes('dovi')) {
      return typeof item.dv_profile === 'number' ? item.dv_profile : 0;
    }
  }
  return null;
}

/** HDR kind from what the stream actually carries, not from the release name. */
function detectHdr(transfer: string | undefined, dvProfile: number | null): SourceHdr {
  if (transfer === 'smpte2084') return dvProfile !== null ? 'dv' : 'hdr10';
  if (transfer === 'arib-std-b67') return 'hlg';
  // Profile 5 has no PQ base layer and is reported with an unspecified transfer.
  if (dvProfile === 5) return 'dv';
  return 'sdr';
}

function isRealVideo(stream: RawStream): boolean {
  if (stream.codec_type !== 'video') return false;
  if (stream.disposition?.attached_pic === 1) return false;
  return !COVER_ART_CODECS.has(stream.codec_name ?? '');
}

function positiveNumber(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function parseProbeOutput(raw: unknown): ProbeResult {
  const probe = (raw ?? {}) as RawProbe;
  const streams = probe.streams ?? [];

  const videoStream = streams.find(isRealVideo);
  if (!videoStream || !videoStream.width || !videoStream.height || videoStream.index === undefined) {
    throw new AppError(
      422,
      'no_video_stream',
      'The selected file has no playable video stream.',
      'Pick a different stream from the list.',
    );
  }

  const dvProfile = dolbyVisionProfile(videoStream);
  const video: VideoInfo = {
    index: videoStream.index,
    codec: videoStream.codec_name ?? 'unknown',
    profile: videoStream.profile ?? '',
    width: videoStream.width,
    height: videoStream.height,
    pixFmt: videoStream.pix_fmt ?? '',
    fps: frameRate(videoStream),
    hdr: detectHdr(videoStream.color_transfer, dvProfile),
    dolbyVisionProfile: dvProfile,
  };

  const audio: AudioTrack[] = [];
  const subtitles: SubtitleTrackInfo[] = [];
  for (const stream of streams) {
    if (stream.index === undefined) continue;
    if (stream.codec_type === 'audio') {
      audio.push({
        index: stream.index,
        codec: stream.codec_name ?? 'unknown',
        channels: stream.channels ?? 0,
        language: tag(stream, 'language') || 'und',
        title: tag(stream, 'title'),
        default: stream.disposition?.default === 1,
      });
    } else if (stream.codec_type === 'subtitle') {
      const codec = stream.codec_name ?? '';
      const kind = TEXT_SUBTITLE_CODECS.has(codec) ? 'text' : BITMAP_SUBTITLE_CODECS.has(codec) ? 'bitmap' : null;
      if (!kind) continue;
      subtitles.push({
        index: stream.index,
        codec,
        language: tag(stream, 'language') || 'und',
        title: tag(stream, 'title'),
        kind,
        forced: stream.disposition?.forced === 1,
        default: stream.disposition?.default === 1,
        ...(kind === 'bitmap' && stream.width && stream.height ? { canvas: { width: stream.width, height: stream.height } } : {}),
      });
    }
  }

  const durationSec = positiveNumber(probe.format?.duration) || positiveNumber(videoStream.duration);
  if (durationSec <= 0) {
    throw new AppError(
      422,
      'unknown_duration',
      'The selected file does not report a duration.',
      'Pick a different stream from the list.',
    );
  }

  return { durationSec, video, audio, subtitles };
}

export type ProbeRunner = (url: string) => Promise<ProbeResult>;

/**
 * Bounded stream analysis: container headers already describe every track, so reading ~3 s / 8 MB of a remote remux is enough
 * and keeps both ffprobe and the encoder's own input probing from downloading far more before the first frame.
 */
export const PROBE_LIMIT_ARGS = ['-probesize', '8M', '-analyzeduration', '3M'];


export function createFfprobeRunner(ffprobePath: string, timeoutMs = 60_000): ProbeRunner {
  return (url) =>
    new Promise<ProbeResult>((resolve, reject) => {
      const child = execFile(
        ffprobePath,
        ['-v', 'error', ...PROBE_LIMIT_ARGS, '-print_format', 'json', '-show_format', '-show_streams', url],
        { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            const detail = redact(`${stderr}`.trim().split(/\r?\n/).slice(-2).join(' ') || error.message);
            reject(
              new AppError(
                502,
                'probe_failed',
                `Could not read the video file: ${detail}`,
                'The TorBox link may have expired or the file may be damaged. Try another stream.',
              ),
            );
            return;
          }
          try {
            resolve(parseProbeOutput(JSON.parse(stdout)));
          } catch (parseError) {
            reject(parseError);
          }
        },
      );
      lowerPriority(child.pid);
    });
}
