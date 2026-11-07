import type { Decision, EncoderStats, SubtitleSelection } from '@homestream/shared';

const VIDEO_CODECS: Record<string, string> = {
  hevc: 'HEVC',
  h264: 'H.264',
  avc: 'H.264',
  av1: 'AV1',
  vp9: 'VP9',
  mpeg2video: 'MPEG-2',
  vc1: 'VC-1',
};

const AUDIO_CODECS: Record<string, string> = {
  truehd: 'TrueHD',
  eac3: 'E-AC-3',
  ac3: 'AC-3',
  dts: 'DTS',
  aac: 'AAC',
  flac: 'FLAC',
  opus: 'Opus',
  mp3: 'MP3',
};

const RANGES: Record<string, string> = { dv: 'Dolby Vision', hdr10: 'HDR10', hlg: 'HLG', sdr: 'SDR' };

/** The short side, or for a cropped wide film the long side, at which each tier starts. */
const TIERS = [
  { label: '2160p', short: 2160, long: 3840 },
  { label: '1440p', short: 1440, long: 2560 },
  { label: '1080p', short: 1080, long: 1920 },
  { label: '720p', short: 720, long: 1280 },
] as const;

/** Wide films are cropped (3840 x 1600), so either side may reach a tier; a portrait frame counts the same way. */
export function resolutionLabel(width: number, height: number): string {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  return TIERS.find((tier) => short >= tier.short || long >= tier.long)?.label ?? '480p';
}

function layoutLabel(channels: number): string {
  const layouts: Record<number, string> = { 1: '1.0', 2: '2.0', 6: '5.1', 8: '7.1' };
  return layouts[channels] ?? `${channels} ch`;
}

function videoCodecName(codec: string): string {
  return VIDEO_CODECS[codec.toLowerCase()] ?? codec.toUpperCase();
}

function audioCodecName(codec: string): string {
  return AUDIO_CODECS[codec.toLowerCase()] ?? codec.toUpperCase();
}

export interface DecisionText {
  sourceVideo: string;
  sourceAudio: string;
  outputVideo: string;
  outputAudio: string;
  toneMapped: boolean;
}

/** Source and output of the server's decision as plain text, e.g. "2160p HEVC Dolby Vision" -> "2160p H.264 SDR". */
export function describeDecision(decision: Decision): DecisionText {
  const { sourceVideo, sourceAudio } = decision;
  return {
    sourceVideo: [
      resolutionLabel(sourceVideo.width, sourceVideo.height),
      videoCodecName(sourceVideo.codec),
      RANGES[sourceVideo.hdr] ?? sourceVideo.hdr.toUpperCase(),
    ].join(' '),
    sourceAudio: `${audioCodecName(sourceAudio.codec)} ${layoutLabel(sourceAudio.channels)}`,
    outputVideo: [
      resolutionLabel(decision.width, decision.height),
      videoCodecName(decision.videoCodec),
      RANGES[decision.dynamicRange] ?? decision.dynamicRange.toUpperCase(),
    ].join(' '),
    outputAudio: `${audioCodecName(decision.audioCodec)} ${layoutLabel(decision.audioChannels)}`,
    toneMapped: decision.toneMapped,
  };
}

/** The short "1080p H.264" line under the title in the top bar. */
export function outputSummary(decision: Decision): string {
  return `${resolutionLabel(decision.width, decision.height)} ${videoCodecName(decision.videoCodec)}`;
}

export function subtitleModeLabel(selection: SubtitleSelection | null): string {
  if (selection === null) return 'off';
  return selection.mode === 'burn' ? 'burn-in' : 'text track';
}

export interface EncoderRows {
  speed: string;
  fps: string;
  bitrate: string;
}

export function describeEncoder(encoder: EncoderStats): EncoderRows {
  return {
    speed: `${encoder.speed.toFixed(1)}x`,
    fps: `${Math.round(encoder.fps)} fps`,
    bitrate: `${(encoder.bitrateKbps / 1000).toFixed(1)} Mbps`,
  };
}
