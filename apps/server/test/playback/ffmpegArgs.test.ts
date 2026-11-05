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
    sessionDir: 'E:\\HomeStream\\transcode\\abc',
    decision: decision(),
    video: { index: 0, codec: 'hevc', pixFmt: 'yuv420p10le', fps: 24 },
    audioIndex: 2,
    startSegment: 0,
    toneMapper: 'libplacebo',
    threads: { gpu: 4, cpu: 8 },
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

  it('bounds input probing before the input', () => {
    expect(valueAfter(args, '-probesize')).toBe('8M');
    expect(valueAfter(args, '-analyzeduration')).toBe('3M');
    expect(args.indexOf('-probesize')).toBeLessThan(args.indexOf('-i'));
  });

  it('forces a keyframe every 4 s and reports progress on stdout', () => {
    expect(valueAfter(args, '-force_key_frames')).toBe('expr:gte(t,n_forced*4)');
    expect(valueAfter(args, '-g')).toBe('96');
    expect(valueAfter(args, '-keyint_min')).toBe('96');
    expect(valueAfter(args, '-progress')).toBe('pipe:1');
    expect(valueAfter(args, '-hls_time')).toBe('4');
  });

  it('writes the playlist under the session dir, with relative segment names', () => {
    expect(args.at(-1)).toBe('E:\\HomeStream\\transcode\\abc\\enc.m3u8');
    expect(valueAfter(args, '-hls_segment_filename')).toBe('seg-%d.m4s');
    expect(valueAfter(args, '-hls_fmp4_init_filename')).toBe('init.mp4');
  });

  it('keeps fMP4 fragment times absolute across restarts (frag_discont) and not for MPEG-TS', () => {
    expect(valueAfter(args, '-hls_segment_options')).toBe('movflags=+frag_discont');
    const ts = buildFfmpegArgs(job({ decision: decision({ videoCodec: 'h264', dynamicRange: 'sdr', audioChannels: 2 }) }));
    expect(ts).not.toContain('-hls_segment_options');
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

describe('subtitle burn-in', () => {
  const sdr = decision({ dynamicRange: 'sdr', width: 1920, height: 1080, videoCodec: 'h264', audioChannels: 2, subtitleBurnIn: true });
  const burnJob = (overrides: Partial<EncodeJob> = {}) =>
    job({
      decision: sdr,
      video: { index: 0, codec: 'h264', pixFmt: 'yuv420p', fps: 24 },
      burn: { index: 5 },
      ...overrides,
    });

  it('decodes in software so the overlay sees system-memory frames', () => {
    const args = buildFfmpegArgs(burnJob());
    expect(args).not.toContain('-hwaccel');
    expect(args).not.toContain('-hwaccel_output_format');
  });

  it('replaces -vf with a filter graph that scales the bitmap to the output size and overlays it', () => {
    const args = buildFfmpegArgs(burnJob());
    expect(args).not.toContain('-vf');
    expect(valueAfter(args, '-filter_complex')).toBe(
      '[0:0]scale=1920:1080:flags=bicubic,format=nv12[v];[0:5]scale=1920:1080:flags=bilinear,format=rgba[s];[v][s]overlay=eof_action=pass:format=auto,format=nv12[vout]',
    );
    expect(args.join(' ')).toContain('-map [vout] -map 0:2');
  });

  it('seeks the input 10 s early and trims the lead-in, so a subtitle already on screen at the seek point is kept', () => {
    const args = buildFfmpegArgs(burnJob({ startSegment: 10 }));
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args.filter((arg) => arg === '-ss')).toHaveLength(2);
    expect(args[args.indexOf('-ss') + 1]).toBe('30');
    expect(args.indexOf('-ss', args.indexOf('-i'))).toBeGreaterThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss', args.indexOf('-i')) + 1]).toBe('10');
    expect(valueAfter(args, '-output_ts_offset')).toBe('40');
  });

  it('trims only what exists before the first segments, and not at all from the start', () => {
    const early = buildFfmpegArgs(burnJob({ startSegment: 1 }));
    expect(early.indexOf('-ss')).toBeGreaterThan(early.indexOf('-i'));
    expect(valueAfter(early, '-ss')).toBe('4');
    expect(buildFfmpegArgs(burnJob({ startSegment: 0 }))).not.toContain('-ss');
  });

  it('passes the authoring canvas of the bitmap track when the container states it', () => {
    const args = buildFfmpegArgs(burnJob({ burn: { index: 5, canvas: { width: 1920, height: 1080 } } }));
    expect(valueAfter(args, '-canvas_size')).toBe('1920x1080');
    expect(args.indexOf('-canvas_size')).toBeLessThan(args.indexOf('-i'));
    expect(buildFfmpegArgs(burnJob())).not.toContain('-canvas_size');
  });

  it('dims the bitmap to SDR reference white when the output stays HDR10', () => {
    const hdr = decision({ subtitleBurnIn: true, width: 1920, height: 1080 });
    const graph = valueAfter(buildFfmpegArgs(burnJob({ decision: hdr })), '-filter_complex');
    expect(graph).toContain('format=rgba,colorchannelmixer=rr=0.58:gg=0.58:bb=0.58[s]');
    expect(graph).toContain('format=p010le[vout]');
  });

  describe('2160p HDR10 kept', () => {
    const uhd = decision({ subtitleBurnIn: true });
    const uhdJob = (overrides: Partial<EncodeJob> = {}) =>
      job({ decision: uhd, video: { index: 0, codec: 'hevc', pixFmt: 'yuv420p10le', fps: 24 }, burn: { index: 4 }, ...overrides });

    it('decodes on NVDEC, downloads p010 frames and renders the bitmap at 1080p before a neighbor upscale', () => {
      const args = buildFfmpegArgs(uhdJob());
      expect(valueAfter(args, '-hwaccel')).toBe('cuda');
      expect(valueAfter(args, '-hwaccel_output_format')).toBe('cuda');
      expect(valueAfter(args, '-filter_complex')).toBe(
        '[0:0]scale_cuda=w=3840:h=2160:format=p010le,hwdownload,format=p010le[v];' +
          '[0:4]scale=1920:1080:flags=bilinear,format=rgba,colorchannelmixer=rr=0.58:gg=0.58:bb=0.58,scale=3840:2160:flags=neighbor[s];' +
          '[v][s]overlay=eof_action=pass:format=auto,format=p010le[vout]',
      );
    });

    it('keeps the 10 s pre-roll and the canvas size', () => {
      const args = buildFfmpegArgs(uhdJob({ startSegment: 10, burn: { index: 4, canvas: { width: 1920, height: 1080 } } }));
      expect(args[args.indexOf('-ss') + 1]).toBe('30');
      expect(valueAfter(args, '-canvas_size')).toBe('1920x1080');
      expect(valueAfter(args, '-output_ts_offset')).toBe('40');
    });

    it('falls back to software decode when NVDEC cannot decode the source', () => {
      const args = buildFfmpegArgs(uhdJob({ video: { index: 0, codec: 'h264', pixFmt: 'yuv420p10le', fps: 24 } }));
      expect(args).not.toContain('-hwaccel');
      expect(valueAfter(args, '-filter_complex')).not.toContain('hwdownload');
    });

    it('is not used for tone-mapped output or below 2160p', () => {
      const mapped = buildFfmpegArgs(uhdJob({ decision: decision({ dynamicRange: 'sdr', toneMapped: true, width: 3840, height: 2160, subtitleBurnIn: true }) }));
      expect(mapped).not.toContain('-hwaccel');
      const hd = buildFfmpegArgs(uhdJob({ decision: decision({ width: 1920, height: 1080, subtitleBurnIn: true }) }));
      expect(hd).not.toContain('-hwaccel');
      expect(valueAfter(hd, '-filter_complex')).not.toContain('neighbor');
    });
  });

  it('overlays after tone mapping, which runs in software from the system-memory frames', () => {
    const mapped = decision({ dynamicRange: 'sdr', toneMapped: true, subtitleBurnIn: true });
    const graph = valueAfter(buildFfmpegArgs(burnJob({ decision: mapped, video: { index: 0, codec: 'hevc', pixFmt: 'yuv420p10le', fps: 24 } })), '-filter_complex');
    expect(graph).toMatch(/^\[0:0\]format=p010le,hwupload,libplacebo=.*hwdownload,format=yuv420p\[v\];/);
  });

  it('is off for a normal job', () => {
    expect(buildFfmpegArgs(job())).not.toContain('-filter_complex');
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

describe('thread caps', () => {
  const threadFlags = (args: string[]) => ({
    threads: valueAfter(args, '-threads'),
    filter: valueAfter(args, '-filter_threads'),
    complex: valueAfter(args, '-filter_complex_threads'),
  });
  const sdrHd = decision({ dynamicRange: 'sdr', width: 1920, height: 1080, videoCodec: 'h264', audioChannels: 2 });

  it('uses the GPU cap on all three flags for a CUDA decode and filter path, before the input', () => {
    const args = buildFfmpegArgs(job());
    expect(threadFlags(args)).toEqual({ threads: '4', filter: '4', complex: '4' });
    for (const flag of ['-threads', '-filter_threads', '-filter_complex_threads']) {
      expect(args.indexOf(flag)).toBeLessThan(args.indexOf('-i'));
    }
    expect(args.filter((arg) => arg === '-threads')).toHaveLength(1);
  });

  it('follows the configured caps', () => {
    expect(threadFlags(buildFfmpegArgs(job({ threads: { gpu: 2, cpu: 6 } })))).toEqual({ threads: '2', filter: '2', complex: '2' });
  });

  it('uses the CPU cap for software burn-in, the hwdownload plus CPU overlay path and the CPU tone-map fallback', () => {
    const burn = job({ decision: sdrHd, video: { index: 0, codec: 'h264', pixFmt: 'yuv420p', fps: 24 }, burn: { index: 5 } });
    expect(threadFlags(buildFfmpegArgs(burn)).threads).toBe('8');
    const uhdBurn = job({ decision: decision({ subtitleBurnIn: true }), burn: { index: 4 } });
    expect(threadFlags(buildFfmpegArgs(uhdBurn)).threads).toBe('8');
    const opencl = job({ decision: decision({ dynamicRange: 'sdr', toneMapped: true }), toneMapper: 'opencl' });
    expect(threadFlags(buildFfmpegArgs(opencl))).toEqual({ threads: '8', filter: '8', complex: '8' });
  });

  it('uses the CPU cap when NVDEC cannot decode the source', () => {
    const software = job({ decision: sdrHd, video: { index: 0, codec: 'h264', pixFmt: 'yuv420p10le', fps: 24 } });
    expect(threadFlags(buildFfmpegArgs(software)).threads).toBe('8');
  });

  it('keeps the GPU cap for libplacebo tone mapping on a CUDA decode', () => {
    const mapped = job({ decision: decision({ dynamicRange: 'sdr', toneMapped: true }) });
    expect(threadFlags(buildFfmpegArgs(mapped)).threads).toBe('4');
  });

  it('does not raise -thread_queue_size or add extra hardware frames', () => {
    const args = buildFfmpegArgs(job());
    expect(args).not.toContain('-thread_queue_size');
    expect(args).not.toContain('-extra_hw_frames');
  });
});
