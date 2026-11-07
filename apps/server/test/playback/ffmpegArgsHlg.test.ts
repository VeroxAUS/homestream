import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs, buildVideoFilter } from '../../src/playback/ffmpegArgs.js';
import { decision, job, valueAfter } from './ffmpegArgsFixtures.js';

describe('HLG source kept as HDR10', () => {
  const hlg = decision({ sourceVideo: { codec: 'hevc', width: 3840, height: 2160, hdr: 'hlg' } });
  const PLACEBO_PQ =
    'libplacebo=colorspace=bt2020nc:color_primaries=bt2020:color_trc=smpte2084:range=tv:format=p010le:w=3840:h=2160';

  it('converts HLG to PQ on Vulkan from downloaded CUDA frames instead of a plain p010 scale', () => {
    const j = job({ decision: hlg });
    expect(buildVideoFilter(j)).toBe(`hwdownload,format=p010le,hwupload,${PLACEBO_PQ},hwdownload,format=p010le`);
    const args = buildFfmpegArgs(j);
    expect(args.join(' ')).toContain('-init_hw_device vulkan=vk -filter_hw_device vk');
    expect(valueAfter(args, '-vf')).toBe(buildVideoFilter(j));
    expect(valueAfter(args, '-profile:v')).toBe('main10');
    expect(valueAfter(args, '-bsf:v')).toBe(
      'hevc_metadata=colour_primaries=9:transfer_characteristics=16:matrix_coefficients=9',
    );
  });

  it('skips the CUDA download when the source is decoded in software', () => {
    const j = job({ decision: hlg, video: { index: 0, codec: 'h264', pixFmt: 'yuv420p10le', fps: 24 } });
    expect(buildVideoFilter(j)).toBe(`format=p010le,hwupload,${PLACEBO_PQ},hwdownload,format=p010le`);
  });

  it('falls back to a software zscale HLG to PQ conversion when libplacebo is unusable', () => {
    const j = job({ decision: hlg, toneMapper: 'opencl' });
    expect(buildVideoFilter(j)).toBe(
      'zscale=w=3840:h=2160:tin=arib-std-b67:t=smpte2084:npl=1000:pin=2020:p=2020:min=2020_ncl:m=2020_ncl:rin=tv:r=tv:f=bicubic,format=p010le',
    );
    const args = buildFfmpegArgs(j);
    expect(args).not.toContain('-hwaccel');
    expect(args.join(' ')).not.toContain('vulkan');
    expect(args.join(' ')).not.toContain('opencl');
    expect(valueAfter(args, '-threads')).toBe('8');
  });

  it('does not touch HDR10 sources or tone-mapped HLG', () => {
    expect(buildVideoFilter(job())).toBe('scale_cuda=w=3840:h=2160:format=p010le');
    const mapped = decision({
      dynamicRange: 'sdr',
      toneMapped: true,
      width: 1920,
      height: 1080,
      sourceVideo: { codec: 'hevc', width: 3840, height: 2160, hdr: 'hlg' },
    });
    expect(buildVideoFilter(job({ decision: mapped }))).toContain('color_trc=bt709');
  });

  it('burn-in keeps the conversion in software and the 10-bit PQ overlay', () => {
    const burned = decision({
      subtitleBurnIn: true,
      sourceVideo: { codec: 'hevc', width: 3840, height: 2160, hdr: 'hlg' },
    });
    const args = buildFfmpegArgs(job({ decision: burned, burn: { index: 4 } }));
    expect(args).not.toContain('-hwaccel');
    const graph = valueAfter(args, '-filter_complex') ?? '';
    expect(
      graph.startsWith(`[0:0]format=p010le,hwupload,${PLACEBO_PQ},hwdownload,format=p010le,format=yuv420p10le[v]`),
    ).toBe(true);
    expect(graph).toContain('colorchannelmixer=rr=0.58');
    expect(graph).toContain('format=p010le[vout]');
  });
});
