import type { AudioTrack, CapabilityProfile, Decision } from '@homestream/shared';
import type { VideoInfo } from './probe.js';

const MAX_OUTPUT_CHANNELS = 6;

export interface DecisionInput {
  video: VideoInfo;
  /** The audio track that will be encoded; null when the file has no audio. */
  audio: AudioTrack | null;
  device: CapabilityProfile;
  subtitleBurnIn?: boolean;
}

function evenDown(value: number): number {
  const whole = Math.max(2, Math.floor(value));
  return whole - (whole % 2);
}

/** Largest even size inside the device limit that keeps the aspect ratio. Never upscales. */
export function fitDimensions(
  source: { width: number; height: number },
  limit: { width: number; height: number },
): { width: number; height: number } {
  const scale = Math.min(1, limit.width / source.width, limit.height / source.height);
  if (scale >= 1) return { width: evenDown(source.width), height: evenDown(source.height) };
  return {
    width: evenDown(Math.min(limit.width, Math.round(source.width * scale))),
    height: evenDown(Math.min(limit.height, Math.round(source.height * scale))),
  };
}

function canKeepHdr(video: VideoInfo, device: CapabilityProfile): boolean {
  const hasHdr10Base = video.hdr === 'hdr10' || (video.hdr === 'dv' && video.dolbyVisionProfile !== 5);
  return hasHdr10Base && device.hevc && device.hdr10 && device.hevcMain10;
}

export function outputAudioChannels(sourceChannels: number, device: CapabilityProfile): number {
  if (sourceChannels <= 0) return 0;
  const deviceLimit = device.kind === 'tv' ? device.maxAudioChannels : Math.min(device.maxAudioChannels, 2);
  return Math.max(1, Math.min(sourceChannels, deviceLimit, MAX_OUTPUT_CHANNELS));
}

export function decide(input: DecisionInput): Decision {
  const { video, audio, device } = input;
  const size = fitDimensions(video, { width: device.maxWidth, height: device.maxHeight });
  const keepHdr = canKeepHdr(video, device);

  return {
    videoCodec: device.hevc ? 'hevc' : 'h264',
    width: size.width,
    height: size.height,
    dynamicRange: keepHdr ? 'hdr10' : 'sdr',
    toneMapped: video.hdr !== 'sdr' && !keepHdr,
    audioCodec: 'aac',
    audioChannels: audio ? outputAudioChannels(audio.channels, device) : 0,
    subtitleBurnIn: input.subtitleBurnIn ?? false,
    sourceVideo: { codec: video.codec, width: video.width, height: video.height, hdr: video.hdr },
    sourceAudio: { codec: audio?.codec ?? 'none', channels: audio?.channels ?? 0 },
  };
}

const ENGLISH = /^en(g|glish)?$/i;

/**
 * Requested track if it exists, else default-flagged English, first English, default-flagged, first.
 * English outranks the default flag: some releases flag a dub as default although the English track is present.
 */
export function selectAudioTrack(tracks: AudioTrack[], requestedIndex?: number): AudioTrack | null {
  if (requestedIndex !== undefined) return tracks.find((track) => track.index === requestedIndex) ?? null;
  return (
    tracks.find((track) => track.default && ENGLISH.test(track.language)) ??
    tracks.find((track) => ENGLISH.test(track.language)) ??
    tracks.find((track) => track.default) ??
    tracks[0] ??
    null
  );
}

export interface VideoBitrate {
  targetKbps: number;
  maxKbps: number;
}

const BITRATE_TABLE: Record<'hevc' | 'h264', Array<{ minHeight: number } & VideoBitrate>> = {
  hevc: [
    { minHeight: 1800, targetKbps: 20_000, maxKbps: 30_000 },
    { minHeight: 900, targetKbps: 8_000, maxKbps: 12_000 },
    { minHeight: 600, targetKbps: 5_000, maxKbps: 8_000 },
    { minHeight: 0, targetKbps: 2_500, maxKbps: 4_000 },
  ],
  h264: [
    { minHeight: 1800, targetKbps: 28_000, maxKbps: 40_000 },
    { minHeight: 900, targetKbps: 10_000, maxKbps: 15_000 },
    { minHeight: 600, targetKbps: 5_000, maxKbps: 8_000 },
    { minHeight: 0, targetKbps: 2_500, maxKbps: 4_000 },
  ],
};

export function videoBitrate(decision: Pick<Decision, 'videoCodec' | 'height'>): VideoBitrate {
  const tier = BITRATE_TABLE[decision.videoCodec].find((row) => decision.height >= row.minHeight);
  const { targetKbps, maxKbps } =
    tier ?? (BITRATE_TABLE[decision.videoCodec].at(-1) as VideoBitrate & { minHeight: number });
  return { targetKbps, maxKbps };
}

export function audioBitrateKbps(channels: number): number {
  return channels <= 2 ? 192 : 64 * channels;
}
