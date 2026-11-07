import type { Decision } from '@homestream/shared';
import type { EncodeJob } from '../../src/playback/ffmpegArgs.js';

export function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    videoCodec: 'hevc',
    width: 3840,
    height: 2160,
    dynamicRange: 'hdr10',
    toneMapped: false,
    audioCodec: 'aac',
    audioChannels: 6,
    subtitleBurnIn: false,
    sourceVideo: { codec: 'hevc', width: 3840, height: 2160, hdr: 'hdr10' },
    sourceAudio: { codec: 'dts', channels: 6 },
    ...overrides,
  };
}

export function job(overrides: Partial<EncodeJob> = {}): EncodeJob {
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

export const valueAfter = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1];
