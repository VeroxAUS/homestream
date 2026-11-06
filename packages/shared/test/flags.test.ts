import { describe, expect, it } from 'vitest';
import { FLAGS, FLAG_KEYS, coerceFlagValue, flagDefault, isFlagKey } from '../src/flags.js';
import { HealthzResponseSchema, ReadyzResponseSchema } from '../src/ops.js';

describe('flag registry', () => {
  it('declares prefetch-on-details (boolean, on) and the banner experiment (9s or 12s, 9s)', () => {
    expect(FLAG_KEYS).toEqual(['prefetch-on-details', 'banner-rotation-interval']);
    expect(FLAGS['prefetch-on-details']).toMatchObject({ type: 'boolean', default: true, status: 'active' });
    expect(FLAGS['banner-rotation-interval']).toMatchObject({
      type: 'multivariate',
      variants: ['9s', '12s'],
      default: '9s',
    });
  });

  it('gives every flag a description and an owner', () => {
    for (const key of FLAG_KEYS) {
      expect(FLAGS[key].description.length).toBeGreaterThan(20);
      expect(FLAGS[key].owner).toBeTruthy();
    }
  });

  it('knows its keys', () => {
    expect(isFlagKey('prefetch-on-details')).toBe(true);
    expect(isFlagKey('stream-picker-layout')).toBe(false);
    expect(isFlagKey('toString')).toBe(false);
  });

  it('returns the local default', () => {
    expect(flagDefault('prefetch-on-details')).toBe(true);
    expect(flagDefault('banner-rotation-interval')).toBe('9s');
  });
});

describe('coerceFlagValue', () => {
  it('accepts a boolean for a boolean flag and falls back to the default for anything else', () => {
    expect(coerceFlagValue('prefetch-on-details', false)).toBe(false);
    expect(coerceFlagValue('prefetch-on-details', true)).toBe(true);
    expect(coerceFlagValue('prefetch-on-details', 'false')).toBe(true);
    expect(coerceFlagValue('prefetch-on-details', undefined)).toBe(true);
  });

  it('accepts a declared variant and falls back to the default for any other value', () => {
    expect(coerceFlagValue('banner-rotation-interval', '12s')).toBe('12s');
    expect(coerceFlagValue('banner-rotation-interval', '9s')).toBe('9s');
    expect(coerceFlagValue('banner-rotation-interval', '30s')).toBe('9s');
    expect(coerceFlagValue('banner-rotation-interval', true)).toBe('9s');
  });
});

describe('ops responses', () => {
  it('describe the probes', () => {
    expect(HealthzResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
    expect(ReadyzResponseSchema.parse({ status: 'ready' })).toEqual({ status: 'ready' });
    expect(HealthzResponseSchema.safeParse({ status: 'ready' }).success).toBe(false);
  });
});
