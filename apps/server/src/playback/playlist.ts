export const SEGMENT_SECONDS = 4;

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

/** Complete VOD playlist, served before the encoder has produced anything. */
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

const SEGMENT_NAME = /^seg-(\d{1,7})\.(ts|m4s)$/;

export type HlsFile =
  | { kind: 'playlist' }
  | { kind: 'init' }
  | { kind: 'segment'; index: number; extension: 'ts' | 'm4s' };

export function parseHlsFileName(name: string): HlsFile | null {
  if (name === 'index.m3u8') return { kind: 'playlist' };
  if (name === 'init.mp4') return { kind: 'init' };
  const match = SEGMENT_NAME.exec(name);
  if (!match) return null;
  return { kind: 'segment', index: Number(match[1]), extension: match[2] as 'ts' | 'm4s' };
}

export function contentTypeFor(file: HlsFile): string {
  if (file.kind === 'playlist') return 'application/vnd.apple.mpegurl';
  if (file.kind === 'init') return 'video/mp4';
  return file.extension === 'ts' ? 'video/mp2t' : 'video/mp4';
}
