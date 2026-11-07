import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_DOWNLOAD_MBPS,
  DEFAULT_READ_AHEAD_RESUME_SEC,
  DEFAULT_READ_AHEAD_SEC,
  bytesPerSecToMbps,
  mbpsToBytesPerSec,
  resolveDownloadLimits,
} from '../../src/network/limits.js';

function resolve(raw: Parameters<typeof resolveDownloadLimits>[0]): {
  limits: ReturnType<typeof resolveDownloadLimits>;
  warnings: string[];
} {
  const warnings: string[] = [];
  return { limits: resolveDownloadLimits(raw, warnings), warnings };
}

describe('resolveDownloadLimits', () => {
  it('uses the defaults 150 / 180 / 120 when nothing is set', () => {
    const { limits, warnings } = resolve({});
    expect(limits).toEqual({ maxDownloadMbps: 150, readAheadSec: 180, readAheadResumeSec: 120 });
    expect(DEFAULT_MAX_DOWNLOAD_MBPS).toBe(150);
    expect(DEFAULT_READ_AHEAD_SEC).toBe(180);
    expect(DEFAULT_READ_AHEAD_RESUME_SEC).toBe(120);
    expect(warnings).toEqual([]);
  });

  it('accepts valid values without warning', () => {
    const { limits, warnings } = resolve({
      MAX_DOWNLOAD_MBPS: '45',
      READ_AHEAD_SEC: '240',
      READ_AHEAD_RESUME_SEC: '150',
    });
    expect(limits).toEqual({ maxDownloadMbps: 45, readAheadSec: 240, readAheadResumeSec: 150 });
    expect(warnings).toEqual([]);
  });

  it('accepts the minimum cap of 5 and fractional values', () => {
    expect(resolve({ MAX_DOWNLOAD_MBPS: '5' }).limits.maxDownloadMbps).toBe(5);
    expect(resolve({ MAX_DOWNLOAD_MBPS: '7.5' }).limits.maxDownloadMbps).toBe(7.5);
  });

  it.each(['abc', '0', '-10', '2', '4.99', ''])(
    'rejects MAX_DOWNLOAD_MBPS=%j with a warning naming the key and the default, never clamping',
    (value) => {
      const { limits, warnings } = resolve({ MAX_DOWNLOAD_MBPS: value });
      expect(limits.maxDownloadMbps).toBe(150);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('MAX_DOWNLOAD_MBPS');
      expect(warnings[0]).toContain('invalid');
      expect(warnings[0]).toContain('default 150');
    },
  );

  it.each(['fast', '0', '-5'])('rejects READ_AHEAD_SEC=%j and restores the pair 180/120', (value) => {
    const { limits, warnings } = resolve({ READ_AHEAD_SEC: value });
    expect(limits.readAheadSec).toBe(180);
    expect(limits.readAheadResumeSec).toBe(120);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('READ_AHEAD_SEC');
    expect(warnings[0]).toContain('defaults 180 and 120');
  });

  it.each(['-1', '0', 'soon'])('rejects READ_AHEAD_RESUME_SEC=%j and restores the pair 180/120', (value) => {
    const { limits, warnings } = resolve({ READ_AHEAD_RESUME_SEC: value });
    expect(limits.readAheadSec).toBe(180);
    expect(limits.readAheadResumeSec).toBe(120);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('READ_AHEAD_RESUME_SEC');
    expect(warnings[0]).toContain('defaults 180 and 120');
  });

  it.each([
    [{ READ_AHEAD_SEC: '240', READ_AHEAD_RESUME_SEC: '-1' }, 'READ_AHEAD_RESUME_SEC'],
    [{ READ_AHEAD_SEC: '240', READ_AHEAD_RESUME_SEC: 'soon' }, 'READ_AHEAD_RESUME_SEC'],
    [{ READ_AHEAD_SEC: 'fast', READ_AHEAD_RESUME_SEC: '150' }, 'READ_AHEAD_SEC'],
    [{ READ_AHEAD_SEC: '0', READ_AHEAD_RESUME_SEC: '60' }, 'READ_AHEAD_SEC'],
  ])('restores 180/120 when one of the pair %j is invalid, even if the other is valid', (raw, key) => {
    const { limits, warnings } = resolve(raw);
    expect(limits).toMatchObject({ readAheadSec: 180, readAheadResumeSec: 120 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(key);
    expect(warnings[0]).toContain('defaults 180 and 120');
  });

  it('puts both window values back to their defaults when the resume point is not below the window', () => {
    const { limits, warnings } = resolve({ READ_AHEAD_SEC: '180', READ_AHEAD_RESUME_SEC: '200' });
    expect(limits).toMatchObject({ readAheadSec: 180, readAheadResumeSec: 120 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('READ_AHEAD_RESUME_SEC');
    expect(warnings[0]).toContain('READ_AHEAD_SEC');

    expect(resolve({ READ_AHEAD_SEC: '240', READ_AHEAD_RESUME_SEC: '240' }).limits).toMatchObject({
      readAheadSec: 180,
      readAheadResumeSec: 120,
    });
  });

  it('judges a lone resume value against the default window', () => {
    expect(resolve({ READ_AHEAD_RESUME_SEC: '150' }).limits).toMatchObject({
      readAheadSec: 180,
      readAheadResumeSec: 150,
    });
    const { limits, warnings } = resolve({ READ_AHEAD_RESUME_SEC: '200' });
    expect(limits).toMatchObject({ readAheadSec: 180, readAheadResumeSec: 120 });
    expect(warnings).toHaveLength(1);
  });

  it('warns for every invalid key when several are wrong', () => {
    const { limits, warnings } = resolve({
      MAX_DOWNLOAD_MBPS: 'abc',
      READ_AHEAD_SEC: 'fast',
      READ_AHEAD_RESUME_SEC: '-1',
    });
    expect(limits).toEqual({ maxDownloadMbps: 150, readAheadSec: 180, readAheadResumeSec: 120 });
    expect(warnings).toHaveLength(3);
    expect(warnings.filter((warning) => warning.includes('READ_AHEAD'))).toHaveLength(2);
  });
});

describe('unit conversion', () => {
  it('counts 1 Mbps as 125,000 bytes per second', () => {
    expect(mbpsToBytesPerSec(60)).toBe(7_500_000);
    expect(bytesPerSecToMbps(7_500_000)).toBe(60);
  });
});
