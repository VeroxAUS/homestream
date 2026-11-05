import { describe, expect, it } from 'vitest';
import { DecisionSchema, SessionStartRequestSchema } from '../src/index.js';

const device = {
  deviceId: 'd1', deviceName: 'TV', kind: 'tv', maxWidth: 3840, maxHeight: 2160,
  h264: true, hevc: true, hevcMain10: true, hdr10: true, maxAudioChannels: 6,
};

describe('SessionStartRequestSchema', () => {
  it('accepts a movie request with auto stream and optional fields', () => {
    const parsed = SessionStartRequestSchema.safeParse({
      mediaType: 'movie', tmdbId: 278, streamId: 'auto', device, startPositionSec: 12.5, audioIndex: 2, subtitle: { index: 3, mode: 'burn' },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a null subtitle and requires season and episode for tv', () => {
    expect(SessionStartRequestSchema.safeParse({ mediaType: 'movie', tmdbId: 1, streamId: 'a', device, subtitle: null }).success).toBe(true);
    expect(SessionStartRequestSchema.safeParse({ mediaType: 'tv', tmdbId: 1, streamId: 'a', device }).success).toBe(false);
    expect(SessionStartRequestSchema.safeParse({ mediaType: 'tv', tmdbId: 1, streamId: 'a', device, season: 1, episode: 2 }).success).toBe(true);
  });

  it('rejects bad bodies', () => {
    for (const bad of [
      { mediaType: 'movie', tmdbId: 1, streamId: 'a' },
      { mediaType: 'movie', tmdbId: 0, streamId: 'a', device },
      { mediaType: 'movie', tmdbId: 1, streamId: '', device },
      { mediaType: 'movie', tmdbId: 1, streamId: 'a', device, subtitle: { index: 1, mode: 'weird' } },
    ]) {
      expect(SessionStartRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('DecisionSchema', () => {
  it('validates the decision object stored on play records', () => {
    const decision = {
      videoCodec: 'hevc', width: 3840, height: 2160, dynamicRange: 'hdr10', toneMapped: false, audioCodec: 'aac', audioChannels: 6,
      subtitleBurnIn: false, sourceVideo: { codec: 'hevc', width: 3840, height: 2160, hdr: 'dv' }, sourceAudio: { codec: 'dts', channels: 6 },
    };
    expect(DecisionSchema.safeParse(decision).success).toBe(true);
    expect(DecisionSchema.safeParse({ ...decision, dynamicRange: 'dv' }).success).toBe(false);
  });
});
