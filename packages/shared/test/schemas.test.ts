import { describe, expect, it } from 'vitest';
import { CapabilityProfileSchema, ErrorResponseSchema, ServerInfoSchema } from '../src/index.js';

const profile = {
  deviceId: 'val-cc4k',
  deviceName: 'Val Chromecast',
  kind: 'tv',
  maxWidth: 3840,
  maxHeight: 2160,
  h264: true,
  hevc: true,
  hevcMain10: true,
  hdr10: true,
  maxAudioChannels: 6,
};

describe('CapabilityProfileSchema', () => {
  it('accepts a valid profile', () => {
    expect(CapabilityProfileSchema.parse(profile)).toEqual(profile);
  });

  it('rejects a missing deviceId', () => {
    const { deviceId: _omit, ...rest } = profile;
    expect(CapabilityProfileSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(CapabilityProfileSchema.safeParse({ ...profile, kind: 'toaster' }).success).toBe(false);
  });
});

describe('ErrorResponseSchema', () => {
  it('allows an optional hint', () => {
    expect(ErrorResponseSchema.safeParse({ error: { code: 'x', message: 'y' } }).success).toBe(true);
    expect(ErrorResponseSchema.safeParse({ error: { code: 'x', message: 'y', hint: 'z' } }).success).toBe(true);
    expect(ErrorResponseSchema.safeParse({ error: { code: 'x' } }).success).toBe(false);
  });
});

describe('ServerInfoSchema', () => {
  it('requires app homestream', () => {
    const info = { app: 'homestream', name: 'n', version: '0.1.0', port: 8600, lanAddresses: ['1.2.3.4'] };
    expect(ServerInfoSchema.safeParse(info).success).toBe(true);
    expect(ServerInfoSchema.safeParse({ ...info, app: 'other' }).success).toBe(false);
  });
});
