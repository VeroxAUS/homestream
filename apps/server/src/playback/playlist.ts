import type { Decision } from '@homestream/shared';
import { audioBitrateKbps, videoBitrate } from './decision.js';

export const SEGMENT_SECONDS = 4;
export const MASTER_PLAYLIST = 'index.m3u8';
export const VIDEO_PLAYLIST = 'video.m3u8';
export const SUBTITLE_GROUP = 'subs';

export type SegmentFormat = 'fmp4' | 'mpegts';

export function segmentFormatFor(videoCodec: 'hevc' | 'h264'): SegmentFormat {
  return videoCodec === 'hevc' ? 'fmp4' : 'mpegts';
}

export function segmentExtension(format: SegmentFormat): 'm4s' | 'ts' {
  return format === 'fmp4' ? 'm4s' : 'ts';
}

export function segmentCount(durationSec: number): number {
  return Math.max(1, Math.ceil(durationSec / SEGMENT_SECONDS - 1e-9));
}

export function segmentFileName(index: number, format: SegmentFormat): string {
  return `seg-${index}.${segmentExtension(format)}`;
}

/** Complete video VOD playlist, served before the encoder has produced anything. */
export function generatePlaylist(durationSec: number, format: SegmentFormat): string {
  const count = segmentCount(durationSec);
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-PLAYLIST-TYPE:VOD', `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`];
  lines.push('#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-INDEPENDENT-SEGMENTS');
  if (format === 'fmp4') lines.push('#EXT-X-MAP:URI="init.mp4"');
  for (let index = 0; index < count; index += 1) {
    const length = index === count - 1 ? durationSec - index * SEGMENT_SECONDS : SEGMENT_SECONDS;
    const clamped = Math.min(SEGMENT_SECONDS, Math.max(0.001, length));
    lines.push(`#EXTINF:${clamped.toFixed(3)},`, segmentFileName(index, format));
  }
  lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

export interface RenditionTrack {
  index: number;
  language: string;
  title: string;
  forced: boolean;
}

const SDH = /\bsdh\b|hearing[- ]impaired|\bhoh\b|\bcc\b|closed caption/i;

function attributeText(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim();
}

/** `<label> [<idx>]`: unique, and the suffix is how clients map a rendition back to the server's track index. */
export function renditionName(track: RenditionTrack): string {
  const label = attributeText(track.title) || (track.language && track.language !== 'und' ? track.language : 'Subtitles');
  return `${label} [${track.index}]`;
}

export function subtitlePlaylistPath(index: number): string {
  return `subs/${index}/index.m3u8`;
}

export interface MasterInput {
  decision: Pick<Decision, 'videoCodec' | 'height' | 'width' | 'audioChannels'>;
  fps: number;
  /** Text tracks that get a rendition, already limited to the maximum. */
  tracks: readonly RenditionTrack[];
}

/**
 * Master playlist: one video variant plus one WebVTT rendition per text track. Subtitles stay off until the user picks
 * one (DEFAULT=NO, AUTOSELECT=NO); a session without text tracks gets the same shape without the SUBTITLES group.
 */
export function generateMasterPlaylist(input: MasterInput): string {
  const { decision } = input;
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
  for (const track of input.tracks) {
    const attributes = ['TYPE=SUBTITLES', `GROUP-ID="${SUBTITLE_GROUP}"`, `NAME="${renditionName(track)}"`];
    if (track.language && track.language !== 'und') attributes.push(`LANGUAGE="${attributeText(track.language)}"`);
    attributes.push('DEFAULT=NO', 'AUTOSELECT=NO', `FORCED=${track.forced ? 'YES' : 'NO'}`);
    if (SDH.test(track.title)) attributes.push('CHARACTERISTICS="public.accessibility.transcribes-spoken-dialog"');
    attributes.push(`URI="${subtitlePlaylistPath(track.index)}"`);
    lines.push(`#EXT-X-MEDIA:${attributes.join(',')}`);
  }
  const audioKbps = decision.audioChannels > 0 ? audioBitrateKbps(decision.audioChannels) : 0;
  const bandwidth = (videoBitrate(decision).maxKbps + audioKbps) * 1000;
  const variant = [`BANDWIDTH=${bandwidth}`, `RESOLUTION=${decision.width}x${decision.height}`];
  if (input.fps > 0) variant.push(`FRAME-RATE=${input.fps.toFixed(3)}`);
  if (input.tracks.length > 0) variant.push(`SUBTITLES="${SUBTITLE_GROUP}"`);
  lines.push(`#EXT-X-STREAM-INF:${variant.join(',')}`, VIDEO_PLAYLIST);
  return `${lines.join('\n')}\n`;
}

/** Subtitle rendition playlist: a pure function of the duration, so it is identical on every request and never waits for extraction. */
export function generateSubtitlePlaylist(durationSec: number): string {
  const count = segmentCount(durationSec);
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD'];
  for (let index = 0; index < count; index += 1) {
    const length = index === count - 1 ? durationSec - index * SEGMENT_SECONDS : SEGMENT_SECONDS;
    lines.push(`#EXTINF:${Math.min(SEGMENT_SECONDS, Math.max(0.001, length)).toFixed(3)},`, `seg-${index}.vtt`);
  }
  lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

const SEGMENT_NAME = /^seg-(\d{1,7})\.(ts|m4s)$/;
const SUBTITLE_SEGMENT_NAME = /^seg-(\d{1,7})\.vtt$/;

export function parseSubtitleSegmentName(name: string): number | null {
  const match = SUBTITLE_SEGMENT_NAME.exec(name);
  return match ? Number(match[1]) : null;
}

const SUBTITLE_FULL_NAME = /^(\d{1,4})\.vtt$/;

export function parseSubtitleFullName(name: string): number | null {
  const match = SUBTITLE_FULL_NAME.exec(name);
  return match ? Number(match[1]) : null;
}

export type HlsFile =
  | { kind: 'master' }
  | { kind: 'playlist' }
  | { kind: 'init' }
  | { kind: 'segment'; index: number; extension: 'ts' | 'm4s' };

export function parseHlsFileName(name: string): HlsFile | null {
  if (name === MASTER_PLAYLIST) return { kind: 'master' };
  if (name === VIDEO_PLAYLIST) return { kind: 'playlist' };
  if (name === 'init.mp4') return { kind: 'init' };
  const match = SEGMENT_NAME.exec(name);
  if (!match) return null;
  return { kind: 'segment', index: Number(match[1]), extension: match[2] as 'ts' | 'm4s' };
}

export function contentTypeFor(file: HlsFile): string {
  if (file.kind === 'master' || file.kind === 'playlist') return 'application/vnd.apple.mpegurl';
  if (file.kind === 'init') return 'video/mp4';
  return file.extension === 'ts' ? 'video/mp2t' : 'video/mp4';
}
