import path from 'node:path';
import type { Decision } from '@homestream/shared';
import { audioBitrateKbps, videoBitrate } from './decision.js';
import { PROBE_LIMIT_ARGS, type VideoInfo } from './probe.js';
import { SEGMENT_SECONDS, segmentExtension, segmentFormatFor } from './playlist.js';

export type ToneMapper = 'libplacebo' | 'opencl';

export const ENCODER_PLAYLIST = 'enc.m3u8';

export interface EncodeJob {
  inputUrl: string;
  sessionDir: string;
  decision: Decision;
  video: Pick<VideoInfo, 'index' | 'codec' | 'pixFmt' | 'fps'>;
  audioIndex: number | null;
  startSegment: number;
  toneMapper: ToneMapper;
  /** Bitmap subtitle track overlaid onto the picture. Forces software decode so the overlay sees system-memory frames. */
  burn?: { index: number; canvas?: { width: number; height: number } } | null;
}

const HW_DECODE_CODECS = new Set(['h264', 'hevc', 'vp9', 'av1', 'mpeg2video', 'mpeg4', 'vc1', 'vp8']);
const HW_DECODE_PIX_FMTS = new Set([
  'yuv420p',
  'yuvj420p',
  'nv12',
  'yuv420p10le',
  'yuv420p12le',
  'p010le',
]);

/** NVDEC cannot decode H.264 10-bit or any 4:2:2/4:4:4 H.264; keep the rule simple and fall back to software. */
export function canHwDecode(video: Pick<VideoInfo, 'codec' | 'pixFmt'>): boolean {
  if (!HW_DECODE_CODECS.has(video.codec)) return false;
  if (!HW_DECODE_PIX_FMTS.has(video.pixFmt)) return false;
  const tenBit = /10|12|p010/.test(video.pixFmt);
  if (tenBit && (video.codec === 'h264' || video.codec === 'mpeg2video' || video.codec === 'mpeg4')) return false;
  return true;
}

function decodesOnGpu(job: EncodeJob): boolean {
  return !job.burn && canHwDecode(job.video);
}

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

const PLACEBO_TONEMAP = 'tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv';
const OPENCL_TONEMAP = 'tonemap=hable:t=bt709:m=bt709:p=bt709';

export function buildVideoFilter(job: EncodeJob): string {
  const { width, height, toneMapped, dynamicRange } = job.decision;
  const hw = decodesOnGpu(job);
  const size = `w=${width}:h=${height}`;

  if (toneMapped && job.toneMapper === 'opencl') {
    return [
      'format=p010le',
      'hwupload',
      `tonemap_opencl=${OPENCL_TONEMAP}:format=nv12`,
      'hwdownload',
      'format=nv12',
      `scale=${width}:${height}:flags=bicubic`,
      'format=yuv420p',
    ].join(',');
  }
  if (toneMapped) {
    const placebo = `libplacebo=${PLACEBO_TONEMAP}:format=yuv420p:${size}`;
    const upload = hw ? ['hwdownload', 'format=p010le', 'hwupload'] : ['format=p010le', 'hwupload'];
    return [...upload, placebo, 'hwdownload', 'format=yuv420p'].join(',');
  }
  const format = dynamicRange === 'hdr10' ? 'p010le' : 'nv12';
  if (hw) return `scale_cuda=${size}:format=${format}`;
  return `scale=${width}:${height}:flags=bicubic,format=${format}`;
}

/**
 * A bitmap subtitle already on screen at the seek point started before it, and an input seek skips that event. Burn-in runs
 * therefore start a little earlier and the lead-in is trimmed from the output, which still begins exactly on the segment.
 */
export const BURN_PREROLL_SEC = 10;

function inputSeekSec(job: EncodeJob): number {
  const start = job.startSegment * SEGMENT_SECONDS;
  return job.burn ? Math.max(0, start - BURN_PREROLL_SEC) : start;
}

function inputArgs(job: EncodeJob): string[] {
  const args: string[] = [];
  const hw = decodesOnGpu(job);
  const toneMapOpencl = job.decision.toneMapped && job.toneMapper === 'opencl';
  const toneMapPlacebo = job.decision.toneMapped && job.toneMapper === 'libplacebo';

  if (inputSeekSec(job) > 0) args.push('-ss', String(inputSeekSec(job)));
  if (toneMapPlacebo) args.push('-init_hw_device', 'vulkan=vk', '-filter_hw_device', 'vk');
  if (toneMapOpencl) args.push('-init_hw_device', 'opencl=ocl', '-filter_hw_device', 'ocl');
  if (hw) {
    args.push('-hwaccel', 'cuda');
    // The OpenCL path takes system-memory frames, so the decoder output is downloaded automatically.
    if (!toneMapOpencl) args.push('-hwaccel_output_format', 'cuda');
  }
  if (isHttp(job.inputUrl)) {
    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '10');
  }
  // Bitmap subtitles are placed on the canvas they were authored for; without it ffmpeg assumes the video size.
  if (job.burn?.canvas) args.push('-canvas_size', `${job.burn.canvas.width}x${job.burn.canvas.height}`);
  args.push(...PROBE_LIMIT_ARGS, '-i', job.inputUrl);
  return args;
}

/** PQ signal level of 203 nits (SDR reference white); full-scale subtitle white would be 10 000 nits. */
const PQ_REFERENCE_WHITE = 0.58;

/** Video chain, then the subtitle bitmap scaled to the output size and overlaid on the finished frames. */
export function buildBurnFilterGraph(job: EncodeJob): string {
  const { width, height, dynamicRange } = job.decision;
  const hdr = dynamicRange === 'hdr10';
  const dim = hdr ? `,colorchannelmixer=rr=${PQ_REFERENCE_WHITE}:gg=${PQ_REFERENCE_WHITE}:bb=${PQ_REFERENCE_WHITE}` : '';
  return [
    `[0:${job.video.index}]${buildVideoFilter(job)}[v]`,
    `[0:${job.burn?.index}]scale=${width}:${height}:flags=bilinear,format=rgba${dim}[s]`,
    `[v][s]overlay=eof_action=pass:format=auto,format=${hdr ? 'p010le' : 'nv12'}[vout]`,
  ].join(';');
}

function videoEncoderArgs(job: EncodeJob): string[] {
  const { decision, video } = job;
  const hevc = decision.videoCodec === 'hevc';
  const hdr = decision.dynamicRange === 'hdr10';
  const rate = videoBitrate(decision);
  const gop = Math.ceil(video.fps * SEGMENT_SECONDS);

  const args = [
    '-c:v', hevc ? 'hevc_nvenc' : 'h264_nvenc',
    '-profile:v', hevc ? (hdr ? 'main10' : 'main') : 'high',
    '-preset', 'p4',
    '-tune', 'hq',
    '-rc', 'vbr',
    '-cq', hevc ? '24' : '23',
    '-b:v', `${rate.targetKbps}k`,
    '-maxrate', `${rate.maxKbps}k`,
    '-bufsize', `${rate.maxKbps * 2}k`,
    '-bf', '0',
    '-g', String(gop),
    '-keyint_min', String(gop),
    '-no-scenecut', '1',
    '-forced-idr', '1',
    '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
  ];
  if (hevc) args.push('-tag:v', 'hvc1');

  // NVENC ignores -color_* options for the stream VUI, so the colour tags are written by a bitstream filter.
  const bsf = hevc ? 'hevc_metadata' : 'h264_metadata';
  if (hdr) args.push('-bsf:v', `${bsf}=colour_primaries=9:transfer_characteristics=16:matrix_coefficients=9`);
  else if (decision.toneMapped) args.push('-bsf:v', `${bsf}=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1`);
  return args;
}

function audioArgs(job: EncodeJob): string[] {
  if (job.audioIndex === null || job.decision.audioChannels === 0) return ['-an'];
  const channels = job.decision.audioChannels;
  return ['-c:a', 'aac', '-b:a', `${audioBitrateKbps(channels)}k`, '-ac', String(channels), '-ar', '48000', '-af', 'aresample=async=1'];
}

function hlsArgs(job: EncodeJob): string[] {
  const format = segmentFormatFor(job.decision.videoCodec);
  const offset = job.startSegment * SEGMENT_SECONDS;
  const args: string[] = [];
  const leadIn = offset - inputSeekSec(job);
  if (leadIn > 0) args.push('-ss', String(leadIn));
  if (offset > 0) args.push('-output_ts_offset', String(offset));
  // Without these MPEG-TS segments start 1.4 s late, which would not match the playlist timeline.
  if (format === 'mpegts') args.push('-muxdelay', '0', '-muxpreload', '0');
  args.push(
    '-f', 'hls',
    '-hls_time', String(SEGMENT_SECONDS),
    '-hls_list_size', '0',
    '-hls_segment_type', format,
    '-hls_flags', 'temp_file+independent_segments',
    '-start_number', String(job.startSegment),
    '-hls_segment_filename', `seg-%d.${segmentExtension(format)}`,
  );
  // Without frag_discont the mp4 muxer writes run-relative fragment times and puts the start offset of a restarted run in an
  // edit list of that run's init.mp4, so segments of different runs would not fit one init. With it the times are absolute.
  if (format === 'fmp4') args.push('-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_options', 'movflags=+frag_discont');
  // An absolute playlist path also puts the session id on the command line, which orphan cleanup relies on.
  args.push(path.join(job.sessionDir, ENCODER_PLAYLIST));
  return args;
}

/** Run with cwd = session dir: relative segment and init names resolve against it. */
export function buildFfmpegArgs(job: EncodeJob): string[] {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats', '-stats_period', '1'];
  args.push(...inputArgs(job));
  if (job.burn) args.push('-filter_complex', buildBurnFilterGraph(job), '-map', '[vout]');
  else args.push('-map', `0:${job.video.index}`);
  if (job.audioIndex !== null) args.push('-map', `0:${job.audioIndex}`);
  args.push('-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn');
  if (!job.burn) args.push('-vf', buildVideoFilter(job));
  args.push(...videoEncoderArgs(job), ...audioArgs(job), ...hlsArgs(job));
  return args;
}
