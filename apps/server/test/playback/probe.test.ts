import { describe, expect, it } from 'vitest';
import { parseProbeOutput } from '../../src/playback/probe.js';

const hdrVideo = {
  index: 0, codec_type: 'video', codec_name: 'hevc', profile: 'Main 10', width: 3840, height: 2160, pix_fmt: 'yuv420p10le',
  color_transfer: 'smpte2084', color_primaries: 'bt2020', avg_frame_rate: '24000/1001', disposition: { default: 1 },
};

function probe(streams: unknown[], duration = '7200.5') {
  return { streams, format: { duration } };
}

describe('parseProbeOutput: video', () => {
  it('detects HDR10 from the PQ transfer', () => {
    const result = parseProbeOutput(probe([hdrVideo]));
    expect(result.video).toMatchObject({ index: 0, codec: 'hevc', width: 3840, height: 2160, hdr: 'hdr10', dolbyVisionProfile: null });
    expect(result.video.fps).toBeCloseTo(23.976, 2);
    expect(result.durationSec).toBe(7200.5);
  });

  it('reports Dolby Vision profile 8 with an HDR10 base as dv', () => {
    const dv = { ...hdrVideo, side_data_list: [{ side_data_type: 'DOVI configuration record', dv_profile: 8, dv_bl_signal_compatibility_id: 1 }] };
    expect(parseProbeOutput(probe([dv])).video).toMatchObject({ hdr: 'dv', dolbyVisionProfile: 8 });
  });

  it('reports Dolby Vision profile 5 as dv even without a PQ transfer', () => {
    const dv = { ...hdrVideo, color_transfer: 'unknown', side_data_list: [{ side_data_type: 'DOVI configuration record', dv_profile: 5 }] };
    expect(parseProbeOutput(probe([dv])).video).toMatchObject({ hdr: 'dv', dolbyVisionProfile: 5 });
  });

  it('detects HLG and SDR', () => {
    expect(parseProbeOutput(probe([{ ...hdrVideo, color_transfer: 'arib-std-b67' }])).video.hdr).toBe('hlg');
    expect(parseProbeOutput(probe([{ ...hdrVideo, color_transfer: 'bt709' }])).video.hdr).toBe('sdr');
    expect(parseProbeOutput(probe([{ ...hdrVideo, color_transfer: undefined }])).video.hdr).toBe('sdr');
  });

  it('ignores attached cover pictures and picks the real video stream', () => {
    const cover = { index: 0, codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 900, disposition: { attached_pic: 1 } };
    const sdr = { ...hdrVideo, index: 1, color_transfer: 'bt709', width: 1920, height: 1080 };
    const result = parseProbeOutput(probe([cover, sdr]));
    expect(result.video).toMatchObject({ index: 1, width: 1920, hdr: 'sdr' });
  });

  it('rejects files without video or duration', () => {
    expect(() => parseProbeOutput(probe([{ index: 0, codec_type: 'audio', codec_name: 'aac' }]))).toThrow(/no playable video/);
    expect(() => parseProbeOutput(probe([hdrVideo], 'N/A'))).toThrow(/duration/);
  });

  it('falls back to a sane frame rate', () => {
    expect(parseProbeOutput(probe([{ ...hdrVideo, avg_frame_rate: '0/0', r_frame_rate: '25/1' }])).video.fps).toBe(25);
    expect(parseProbeOutput(probe([{ ...hdrVideo, avg_frame_rate: '0/0', r_frame_rate: '0/0' }])).video.fps).toBe(24);
  });

  it('uses the stream duration when the container has none', () => {
    const result = parseProbeOutput({ streams: [{ ...hdrVideo, duration: '90.25' }], format: {} });
    expect(result.durationSec).toBe(90.25);
  });
});

describe('parseProbeOutput: tracks', () => {
  const streams = [
    hdrVideo,
    { index: 1, codec_type: 'audio', codec_name: 'dts', channels: 6, tags: { language: 'eng', title: 'DTS-HD MA 5.1' }, disposition: { default: 1 } },
    { index: 2, codec_type: 'audio', codec_name: 'eac3', channels: 6, tags: { LANGUAGE: 'rus' }, disposition: { default: 0 } },
    { index: 3, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'eng' }, disposition: { default: 0, forced: 1 } },
    { index: 4, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', tags: { language: 'fra', title: 'French' }, disposition: { default: 1 } },
    { index: 5, codec_type: 'subtitle', codec_name: 'eia_608' },
    { index: 6, codec_type: 'attachment', codec_name: 'ttf' },
  ];

  it('lists audio tracks with absolute stream indices and flags', () => {
    expect(parseProbeOutput(probe(streams)).audio).toEqual([
      { index: 1, codec: 'dts', channels: 6, language: 'eng', title: 'DTS-HD MA 5.1', default: true },
      { index: 2, codec: 'eac3', channels: 6, language: 'rus', title: '', default: false },
    ]);
  });

  it('classifies subtitles as text or bitmap and drops unsupported ones', () => {
    expect(parseProbeOutput(probe(streams)).subtitles).toEqual([
      { index: 3, codec: 'subrip', language: 'eng', title: '', kind: 'text', forced: true, default: false },
      { index: 4, codec: 'hdmv_pgs_subtitle', language: 'fra', title: 'French', kind: 'bitmap', forced: false, default: true },
    ]);
  });
});
