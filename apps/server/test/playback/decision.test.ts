import type { AudioTrack } from '@homestream/shared';
import { describe, expect, it } from 'vitest';
import {
  audioBitrateKbps,
  decide,
  fitDimensions,
  outputAudioChannels,
  selectAudioTrack,
  videoBitrate,
} from '../../src/playback/decision.js';
import type { VideoInfo } from '../../src/playback/probe.js';
import { PROFILES } from './harness.js';

function video(overrides: Partial<VideoInfo> = {}): VideoInfo {
  return {
    index: 0,
    codec: 'hevc',
    profile: 'Main 10',
    width: 3840,
    height: 2160,
    pixFmt: 'yuv420p10le',
    fps: 23.976,
    hdr: 'hdr10',
    dolbyVisionProfile: null,
    ...overrides,
  };
}

const audio = (channels: number, overrides: Partial<AudioTrack> = {}): AudioTrack => ({
  index: 1,
  codec: 'dts',
  channels,
  language: 'eng',
  title: '',
  default: true,
  ...overrides,
});

describe('decide: video', () => {
  const uhdHdr = video();
  const uhdDv = video({ hdr: 'dv', dolbyVisionProfile: 8 });
  const uhdSdr = video({ hdr: 'sdr', pixFmt: 'yuv420p', profile: 'Main' });
  const fhdSdr = video({ width: 1920, height: 1080, hdr: 'sdr', codec: 'h264', pixFmt: 'yuv420p' });
  const hd720 = video({ width: 1280, height: 720, hdr: 'sdr', codec: 'h264', pixFmt: 'yuv420p' });

  const matrix: Array<[string, VideoInfo, keyof typeof PROFILES, object]> = [
    [
      '4K HDR10 -> chromecast4k keeps HDR10',
      uhdHdr,
      'chromecast4k',
      { videoCodec: 'hevc', width: 3840, height: 2160, dynamicRange: 'hdr10', toneMapped: false },
    ],
    [
      '4K DV (p8) -> chromecast4k falls back to the HDR10 base',
      uhdDv,
      'chromecast4k',
      { videoCodec: 'hevc', width: 3840, height: 2160, dynamicRange: 'hdr10', toneMapped: false },
    ],
    [
      '4K HDR10 -> emulator tone-maps to 1080p HEVC SDR',
      uhdHdr,
      'emulator',
      { videoCodec: 'hevc', width: 1920, height: 1080, dynamicRange: 'sdr', toneMapped: true },
    ],
    [
      '4K HDR10 -> desktop is source-size H.264 SDR',
      uhdHdr,
      'desktop',
      { videoCodec: 'h264', width: 3840, height: 2160, dynamicRange: 'sdr', toneMapped: true },
    ],
    [
      '4K HDR10 -> p720 is 720p H.264 SDR',
      uhdHdr,
      'p720',
      { videoCodec: 'h264', width: 1280, height: 720, dynamicRange: 'sdr', toneMapped: true },
    ],
    [
      '4K SDR -> chromecast4k is 4K HEVC 8-bit',
      uhdSdr,
      'chromecast4k',
      { videoCodec: 'hevc', width: 3840, height: 2160, dynamicRange: 'sdr', toneMapped: false },
    ],
    [
      '4K SDR -> emulator scales to 1080p without tone mapping',
      uhdSdr,
      'emulator',
      { videoCodec: 'hevc', width: 1920, height: 1080, dynamicRange: 'sdr', toneMapped: false },
    ],
    [
      '4K SDR -> desktop stays 4K H.264',
      uhdSdr,
      'desktop',
      { videoCodec: 'h264', width: 3840, height: 2160, dynamicRange: 'sdr', toneMapped: false },
    ],
    [
      '1080p -> chromecast4k is not upscaled',
      fhdSdr,
      'chromecast4k',
      { videoCodec: 'hevc', width: 1920, height: 1080, toneMapped: false },
    ],
    ['1080p -> desktop is not upscaled', fhdSdr, 'desktop', { videoCodec: 'h264', width: 1920, height: 1080 }],
    ['1080p -> emulator is HEVC at 1080p', fhdSdr, 'emulator', { videoCodec: 'hevc', width: 1920, height: 1080 }],
    [
      '1080p -> p720 is capped to 720p',
      fhdSdr,
      'p720',
      { videoCodec: 'h264', width: 1280, height: 720, toneMapped: false },
    ],
    ['720p -> chromecast4k is not upscaled', hd720, 'chromecast4k', { videoCodec: 'hevc', width: 1280, height: 720 }],
  ];

  it.each(matrix)('%s', (_name, source, profile, expected) => {
    expect(decide({ video: source, audio: audio(6), device: PROFILES[profile] })).toMatchObject(expected);
  });

  it('keeps the aspect ratio of scope sources and uses even sizes', () => {
    const scope = video({ width: 3840, height: 1600 });
    expect(decide({ video: scope, audio: null, device: PROFILES.emulator })).toMatchObject({
      width: 1920,
      height: 800,
    });
    expect(fitDimensions({ width: 1918, height: 1079 }, { width: 3840, height: 2160 })).toEqual({
      width: 1918,
      height: 1078,
    });
    expect(fitDimensions({ width: 3840, height: 2160 }, { width: 1280, height: 720 })).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it('tone-maps instead of keeping HDR when the device lacks Main10 or HDR10 support', () => {
    const noMain10 = { ...PROFILES.chromecast4k, hevcMain10: false };
    const noHdr = { ...PROFILES.chromecast4k, hdr10: false };
    expect(decide({ video: video(), audio: null, device: noMain10 })).toMatchObject({
      dynamicRange: 'sdr',
      toneMapped: true,
      videoCodec: 'hevc',
    });
    expect(decide({ video: video(), audio: null, device: noHdr })).toMatchObject({
      dynamicRange: 'sdr',
      toneMapped: true,
    });
  });

  it('tone-maps HLG and Dolby Vision profile 5 (no HDR10 base layer)', () => {
    expect(decide({ video: video({ hdr: 'hlg' }), audio: null, device: PROFILES.chromecast4k })).toMatchObject({
      dynamicRange: 'sdr',
      toneMapped: true,
    });
    expect(
      decide({ video: video({ hdr: 'dv', dolbyVisionProfile: 5 }), audio: null, device: PROFILES.chromecast4k }),
    ).toMatchObject({ dynamicRange: 'sdr', toneMapped: true });
  });

  it('records the source details and subtitle burn-in flag', () => {
    const decision = decide({
      video: video({ hdr: 'dv', dolbyVisionProfile: 8 }),
      audio: audio(8, { codec: 'truehd' }),
      device: PROFILES.chromecast4k,
      subtitleBurnIn: true,
    });
    expect(decision.sourceVideo).toEqual({ codec: 'hevc', width: 3840, height: 2160, hdr: 'dv' });
    expect(decision.sourceAudio).toEqual({ codec: 'truehd', channels: 8 });
    expect(decision.subtitleBurnIn).toBe(true);
    expect(decision.audioCodec).toBe('aac');
  });
});

describe('audio decisions', () => {
  it.each([
    [8, 'chromecast4k', 6],
    [6, 'chromecast4k', 6],
    [2, 'chromecast4k', 2],
    [6, 'emulator', 6],
    [6, 'desktop', 2],
    [6, 'p720', 2],
    [2, 'desktop', 2],
    [1, 'chromecast4k', 1],
  ] as const)('%i source channels on %s -> %i', (channels, profile, expected) => {
    expect(outputAudioChannels(channels, PROFILES[profile])).toBe(expected);
  });

  it('caps a tv device that reports fewer channels than the source', () => {
    expect(outputAudioChannels(6, { ...PROFILES.chromecast4k, maxAudioChannels: 2 })).toBe(2);
  });

  it('has no audio output for a file without audio', () => {
    expect(decide({ video: video(), audio: null, device: PROFILES.chromecast4k }).audioChannels).toBe(0);
  });

  it('picks the audio bitrate by channel count', () => {
    expect(audioBitrateKbps(2)).toBe(192);
    expect(audioBitrateKbps(6)).toBe(384);
  });
});

describe('selectAudioTrack', () => {
  const rus = audio(6, { index: 1, language: 'rus', default: false });
  const eng = audio(2, { index: 2, language: 'eng', default: false });
  const flagged = audio(6, { index: 3, language: 'fra', default: true });

  const engFlagged = audio(2, { index: 4, language: 'en', default: true });
  const engSecond = audio(2, { index: 5, language: 'eng', default: false });

  it('prefers the default-flagged English track', () =>
    expect(selectAudioTrack([rus, engSecond, engFlagged, flagged])?.index).toBe(4));
  it('picks the first English track over a default-flagged non-English one', () => {
    expect(selectAudioTrack([rus, eng, flagged])?.index).toBe(2);
    expect(selectAudioTrack([flagged, engSecond, eng])?.index).toBe(5);
  });
  it('falls back to the default-flagged track when nothing is English', () =>
    expect(selectAudioTrack([rus, flagged])?.index).toBe(3));
  it('falls back to English when nothing is flagged', () => expect(selectAudioTrack([rus, eng])?.index).toBe(2));
  it('falls back to the first track', () => expect(selectAudioTrack([rus])?.index).toBe(1));
  it('honours an explicit index and rejects unknown ones', () => {
    expect(selectAudioTrack([rus, eng, flagged], 1)?.index).toBe(1);
    expect(selectAudioTrack([rus, eng, flagged], 9)).toBeNull();
  });
  it('returns null without tracks', () => expect(selectAudioTrack([])).toBeNull());
});

describe('videoBitrate', () => {
  it.each([
    ['hevc', 2160, 20_000, 30_000],
    ['hevc', 1080, 8_000, 12_000],
    ['h264', 1080, 10_000, 15_000],
    ['h264', 720, 5_000, 8_000],
    ['hevc', 480, 2_500, 4_000],
  ] as const)('%s at %ip', (videoCodec, height, targetKbps, maxKbps) => {
    expect(videoBitrate({ videoCodec, height })).toEqual({ targetKbps, maxKbps });
  });
});
