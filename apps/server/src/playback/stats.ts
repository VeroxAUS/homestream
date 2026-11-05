import { SEGMENT_SECONDS } from './playlist.js';

/** ffmpeg's `-progress` reports `bitrate=N/A` for the HLS muxer, so the rate is derived from finished segment files. */
export function bitrateKbpsFromSegments(sizesBytes: number[], segmentSec = SEGMENT_SECONDS): number {
  const sizes = sizesBytes.filter((size) => size > 0);
  if (sizes.length === 0) return 0;
  const bytes = sizes.reduce((sum, size) => sum + size, 0);
  return Math.round(((bytes * 8) / 1000 / (sizes.length * segmentSec)) * 10) / 10;
}
