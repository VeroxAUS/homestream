import type { Decision } from '@homestream/shared';
import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs, buildVideoFilter, canHwDecode, type EncodeJob } from '../../src/playback/ffmpegArgs.js';

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    videoCodec: 'hevc', width: 3840, height: 2160, dynamicRange: 'hdr10', toneMapped: false, audioCodec: 'aac',
    audioChannels: 6, subtitleBurnIn: false,
    sourceVideo: { codec: 'hevc', width: 3840, height: 2160, hdr: 'hdr10' },
    sourceAudio: { codec: 'dts', channels: 6 },
    ...overrides,
  };
}

function job(overrides: Partial<EncodeJob> = {}): EncodeJob {
  return {
    inputUrl: 'https://store-001.example.test/file.mkv',
    sessionDir: 'D:\\HomeStream\\transcode\\abc',
    decision: decision(),
    video: { index: 0, codec: 'hevc', pixFmt: 'yuv420p10le', fps: 24 },
    audioIndex: 2,
    startSegment: 0,
    toneMapper: 'libplacebo',
    ...overrides,
  };
}

const valueAfter = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1];

describe('buildFfmpegArgs: shared structure', () => {
  const args = buildFfmpegArgs(job());

  it('maps video and audio explicitly by stream index and drops metadata, subtitles and data', () => {
    expect(args.join(' ')).toContain('-map 0:0 -map 0:2');
    expect(args).toEqual(expect.arrayContaining(['-sn', '-dn', '-map_metadata', '-1']));
  });

  it('adds reconnect flags for http inputs only', () => {
    expect(args).toEqual(expect.arrayContaining(['-reconnect', '-reconnect_streamed', '-reconnect_on_network_error', '-reconnect_delay_max']));
    expect(buildFfmpegArgs(job({ inputUrl: 'D:\\local\\file.mkv' }))).not.toContain('-reconnect');
  });

  it('forces a keyframe every 4 s and reports progress on stdout', () => {
    expect(valueAfter(args, '-force_key_frames')).toBe('expr:gte(t,n_forced*4)');
    expect(valueAfter(args, '-g')).toBe('96');
    expect(valueAfter(args, '-keyint_min')).toBe('96');
    expect(valueAfter(args, '-progress')).toBe('pipe:1');
    expect(valueAfter(args, '-hls_time')).toBe('4');
  });

  it('writes the playlist under the session dir, with relative segment names', () => {
    expect(args.at(-1)).toBe('D:\\HomeStream\\transcode\\abc\\enc.m3u8');
    expect(valueAfter(args, '-hls_segment_filename')).toBe('seg-%d.m4s');
    expect(valueAfter(args, '-hls_fmp4_init_filename')).toBe('init.mp4');
  });

  it('derives the GOP from the source frame rate', () => {
    expect(valueAfter(buildFfmpegArgs(job({ video: { index: 0, codec: 'hevc', pixFmt: 'yuv420p10le', fps: 23.976 } })), '-g')).toBe('96');
    expect(valueAfter(buildFfmpegArgs(job({ video: { index: 0, codec: 'hevc', pixFmt: 'yuv420p10le', fps: 29.97 } })), '-g')).toBe('120');
    expect(valueAfter(buildFfmpegArgs(job({ video: { index: 0, codec: 'hevc', pixFmt: 'yuv420p10le', fps: 25 } })), '-g')).toBe('100');
  });

  it('uses CUDA decode and keeps frames on the GPU', () => {
    expect(args.join(' ')).toContain('-hwaccel cuda -hwaccel_output_format cuda');
  });
});

describe('buildFfmpegArgs: seeking', () => {
  it('starts at 0 without -ss or a timestamp offset', () => {
    const args = buildFfmpegArgs(job());
    expect(args).not.toContain('-ss');
    expect(args).not.toContain('-output_ts_offset');
    expect(valueAfter(args, '-start_number')).toBe('0');
  });

  it('seeks the input and offsets the output timestamps by the segment start', () => {
    const args = buildFfmpegArgs(job({ startSegment: 300 }));
    expect(valueAfter(args, '-ss')).toBe('1200');
    expect(valueAfter(args, '-output_ts_offset')).toBe('1200');
    expect(valueAfter(args, '-start_number')).toBe('300');
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args.indexOf('-output_ts_offset')).toBeGreaterThan(args.indexOf('-i'));
  });
});

describe('buildFfmpegArgs: encoders', () => {
  it('HDR10 pass-through: hevc Main10 from p010 frames with the HDR10 tags written by a bitstream filter', () => {
    const args = buildFfmpegArgs(job());
    expect(valueAfter(args, '-c:v')).toBe('hevc_nvenc');
    expect(valueAfter(args, '-profile:v')).toBe('main10');
    expect(valueAfter(args, '-tag:v')).toBe('hvc1');
    expect(valueAfter(args, '-bsf:v')).toBe('hevc_metadata=colour_primaries=9:transfer_characteristics=16:matrix_coefficients=9');
    expect(valueAfter(args, '-vf')).toBe('scale_cuda=w=3840:h=2160:format=p010le');
    expect(args).not.toContain('-pix_fmt');
    expect(valueAfter(args, '-b:v')).toBe('20000k');
    expect(valueAfter(args, '-maxrate')).toBe('30000k');
    expect(valueAfter(args, '-hls_segment_type')).toBe('fmp4');
  });

  it('SDR hevc: Main profile, nv12 frames, no colour bitstream filter', () => {
    const args = buildFfmpegArgs(job({ decision: decision({ dynamicRange: 'sdr', width: 1920, height: 1080 }) }));
    expect(valueAfter(args, '-profile:v')).toBe('main');
    expect(valueAfter(args, '-vf')).toBe('scale_cuda=w=1920:h=1080:format=nv12');
    expect(args).not.toContain('-bsf:v');
    expect(valueAfter(args, '-b:v')).toBe('8000k');
  });

  it('H.264 uses MPEG-TS, drops the init file and removes the MPEG-TS mux delay', () => {
    const args = buildFfmpegArgs(job({ decision: decision({ videoCodec: 'h264', dynamicRange: 'sdr', audioChannels: 2 }) }));
    expect(valueAfter(args, '-c:v')).toBe('h264_nvenc');
    expect(valueAfter(args, '-profile:v')).toBe('high');
    expect(args).not.toContain('-tag:v');
    expect(valueAfter(args, '-hls_segment_type')).toBe('mpegts');
    expect(valueAfter(args, '-hls_segment_filename')).toBe('seg-%d.ts');
    expect(args).not.toContain('-hls_fmp4_init_filename');
    expect(valueAfter(args, '-muxdelay')).toBe('0');
  });

  it('encodes audio as AAC with the decided channel count and bitrate', () => {
    const six = buildFfmpegArgs(job());
    expect(six.join(' ')).toContain('-c:a aac -b:a 384k -ac 6');
    const stereo = buildFfmpegArgs(job({ decision: decision({ audioChannels: 2 }) }));
    expect(stereo.join(' ')).toContain('-c:a aac -b:a 192k -ac 2');
  });

  it('drops audio entirely for a file without an audio track', () => {
    const args = buildFfmpegArgs(job({ audioIndex: null, decision: decision({ audioChannels: 0 }) }));
    expect(args).toContain('-an');
    expect(args.filter((a) => a === '-map')).toHaveLength(1);
  });
});

describe('tone mapping filters', () => {
  const mapped = decision({ dynamicRange: 'sdr', toneMapped: true, width: 1920, height: 1080 });

  it('libplacebo: downloads CUDA frames, tone-maps on Vulkan to bt709 and scales in the same filter', () => {
    const j = job({ decision: mapped });
    const filter = buildVideoFilter(j);
    expect(filter).toBe(
      'hwdownload,format=p010le,hwupload,libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p:w=1920:h=1080,hwdownload,format=yuv420p',
    );
    const args = buildFfmpegArgs(j);
    expect(args.join(' ')).toContain('-init_hw_device vulkan=vk -filter_hw_device vk');
    expect(valueAfter(args, '-bsf:v')).toBe('hevc_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1');
    expect(valueAfter(args, '-profile:v')).toBe('main');
  });

  it('tonemap_opencl fallback: system-memory frames, hable, scale afterwards', () => {
    const j = job({ decision: mapped, toneMapper: 'opencl' });
    expect(buildVideoFilter(j)).toBe(
      'format=p010le,hwupload,tonemap_opencl=tonemap=hable:t=bt709:m=bt709:p=bt709:format=nv12,hwdownload,format=nv12,scale=1920:1080:flags=bicubic,format=yuv420p',
    );
    const args = buildFfmpegArgs(j);
    expect(args.join(' ')).toContain('-init_hw_device opencl=ocl -filter_hw_device ocl');
    expect(args.join(' ')).toContain('-hwaccel cuda');
    expect(args).not.toContain('-hwaccel_output_format');
  });

  it('software decode skips the hwdownload before the Vulkan upload', () => {
    const j = job({ decision: mapped, video: { index: 0, codec: 'h264', pixFmt: 'yuv420p10le', fps: 24 } });
    expect(buildVideoFilter(j).startsWith('format=p010le,hwupload,libplacebo=')).toBe(true);
    expect(buildFfmpegArgs(j)).not.toContain('-hwaccel');
  });

  it('tone-mapped H.264 for the desktop is tagged bt709 through h264_metadata', () => {
    const args = buildFfmpegArgs(job({ decision: decision({ videoCodec: 'h264', dynamicRange: 'sdr', toneMapped: true, audioChannels: 2 }) }));
    expect(valueAfter(args, '-bsf:v')).toBe('h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1');
  });
});

describe('software decode fallback', () => {
  it('uses CPU scaling for sources NVDEC cannot decode', () => {
    const j = job({ decision: decision({ dynamicRange: 'sdr', width: 1920, height: 1080 }), video: { index: 0, codec: 'h264', pixFmt: 'yuv420p10le', fps: 24 } });
    expect(buildVideoFilter(j)).toBe('scale=1920:1080:flags=bicubic,format=nv12');
    expect(buildFfmpegArgs(j)).not.toContain('-hwaccel');
  });

  it.each([
    ['h264', 'yuv420p', true],
    ['h264', 'yuv420p10le', false],
    ['h264', 'yuv422p', false],
    ['hevc', 'yuv420p10le', true],
    ['hevc', 'yuv420p', true],
    ['vp9', 'yuv420p10le', true],
    ['wmv3', 'yuv420p', false],
  ])('canHwDecode(%s, %s) = %s', (codec, pixFmt, expected) => {
    expect(canHwDecode({ codec, pixFmt })).toBe(expected);
  });
});
