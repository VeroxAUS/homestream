import { StreamOptionSchema } from '@homestream/shared';
import { describe, expect, it } from 'vitest';
import { streamId, type GatewayStream } from '../../src/gateway/types.js';
import { formatSize, isCachedName, parseStream } from '../../src/streams/parse.js';
import { CACHED_NAME, FILENAME_CASES, UNCACHED_NAME } from './fixtures.js';

function raw(filename: string, overrides: Partial<GatewayStream> = {}): GatewayStream {
  const url = `https://gateway.example.test/playback/${encodeURIComponent(filename)}`;
  return { id: streamId(url), name: CACHED_NAME, url, filename, videoSize: 12_345_678_901, ...overrides };
}

describe('parseStream (release-name table)', () => {
  it.each(FILENAME_CASES)('$filename', (item) => {
    const parsed = parseStream(raw(item.filename));
    expect({
      resolution: parsed.resolution,
      videoCodec: parsed.videoCodec,
      hdr: parsed.hdr,
      source: parsed.source,
      audio: parsed.audio,
      ...(item.languages ? { languages: parsed.languages } : {}),
    }).toEqual({
      resolution: item.resolution,
      videoCodec: item.videoCodec,
      hdr: item.hdr,
      source: item.source,
      audio: item.audio,
      ...(item.languages ? { languages: item.languages } : {}),
    });
  });

  it('always produces an item matching the shared StreamOption schema', () => {
    for (const item of FILENAME_CASES) {
      expect(StreamOptionSchema.safeParse(parseStream(raw(item.filename))).success, item.filename).toBe(true);
    }
  });
});

describe('parseStream (identity and flags)', () => {
  it('derives a stable 16-hex id from the URL', () => {
    const url = 'https://gateway.example.test/a/b/c.mkv';
    expect(streamId(url)).toMatch(/^[0-9a-f]{16}$/);
    expect(streamId(url)).toBe(streamId(url));
    expect(streamId(`${url}?x=1`)).not.toBe(streamId(url));
  });

  it('reads the cached flag from the name marker only', () => {
    expect(isCachedName(CACHED_NAME)).toBe(true);
    expect(isCachedName(UNCACHED_NAME)).toBe(false);
    expect(isCachedName('')).toBe(false);
    expect(parseStream(raw('A.2160p.mkv', { name: UNCACHED_NAME })).cached).toBe(false);
    expect(parseStream(raw('A.2160p.mkv', { name: CACHED_NAME })).cached).toBe(true);
  });

  it('keeps the gateway size and exposes a plain-text label without URLs', () => {
    const parsed = parseStream(
      raw('Dune.Part.Two.2024.UHD.BluRay.2160p.TrueHD.Atmos.7.1.DV.HEVC.REMUX-GRP.mkv', { videoSize: 69_717_458_054 }),
    );
    expect(parsed.sizeBytes).toBe(69_717_458_054);
    expect(parsed.label).toBe('2160p · Dolby Vision · HEVC · Remux · TrueHD Atmos 7.1 · 69.7 GB · Cached');
    expect(parsed.label).not.toMatch(/https?:/);
  });

  it('omits unknown parts from the label and marks uncached streams', () => {
    const parsed = parseStream(raw('mystery.avi', { name: UNCACHED_NAME, videoSize: 0 }));
    expect(parsed.label).toBe('Not cached');
  });

  it('formats sizes', () => {
    expect(formatSize(0)).toBe('');
    expect(formatSize(5_500_000)).toBe('6 MB');
    expect(formatSize(8_685_560_485)).toBe('8.7 GB');
  });
});

describe('parseStream (resolution precedence)', () => {
  it.each([
    ['Movie.2022.UHD.BDRip.1440p.mkv', '1440p'],
    ['Movie.2022.1440p.WEB-DL.x264.mkv', '1440p'],
    ['Movie.2022.1080p.UHD.BluRay.x265.mkv', '1080p'],
    ['Movie.2022.4K.1080p.WEB-DL.mkv', '1080p'],
    ['Movie.2022.UHD.720p.HDTV.mkv', '720p'],
    ['Movie.2022.4K.WEB-DL.mkv', '2160p'],
    ['Movie.2022.UHD.BluRay.mkv', '2160p'],
    ['Movie.2022.3840x2160.mkv', '2160p'],
    ['Movie.2022.BluRay.mkv', 'unknown'],
  ])('%s -> %s', (filename, resolution) => {
    expect(parseStream(raw(filename)).resolution).toBe(resolution);
  });

  it('labels a 1440p item with its resolution', () => {
    expect(parseStream(raw('Movie.2022.1440p.WEB-DL.mkv')).label.startsWith('1440p')).toBe(true);
  });
});
