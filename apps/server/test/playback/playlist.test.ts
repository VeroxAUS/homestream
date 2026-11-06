import { describe, expect, it } from 'vitest';
import {
  contentTypeFor,
  generatePlaylist,
  parseHlsFileName,
  segmentCount,
  segmentFormatFor,
} from '../../src/playback/playlist.js';

describe('generatePlaylist', () => {
  it('writes a complete fMP4 VOD playlist with an init map', () => {
    const lines = generatePlaylist(10, 'fmp4').trimEnd().split('\n');
    expect(lines.slice(0, 6)).toEqual([
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-TARGETDURATION:4',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-INDEPENDENT-SEGMENTS',
    ]);
    expect(lines).toContain('#EXT-X-MAP:URI="init.mp4"');
    expect(lines.slice(-5)).toEqual(['#EXTINF:4.000,', 'seg-1.m4s', '#EXTINF:2.000,', 'seg-2.m4s', '#EXT-X-ENDLIST']);
  });

  it('uses MPEG-TS segments without an init map for H.264', () => {
    const text = generatePlaylist(8, 'mpegts');
    expect(text).not.toContain('#EXT-X-MAP');
    expect(text).toContain('seg-0.ts');
    expect(text).toContain('seg-1.ts');
    expect(text).not.toContain('seg-2.ts');
    expect(text.match(/#EXTINF:4\.000,/g)).toHaveLength(2);
  });

  it('has ceil(duration / 4) segments, the last one possibly shorter', () => {
    for (const duration of [0.5, 3.99, 4, 4.01, 3600.2, 8812.7]) {
      const text = generatePlaylist(duration, 'fmp4');
      const durations = [...text.matchAll(/#EXTINF:([\d.]+),/g)].map((m) => Number(m[1]));
      expect(durations).toHaveLength(Math.ceil(duration / 4));
      expect(durations.every((d) => d > 0 && d <= 4)).toBe(true);
      expect(durations.reduce((a, b) => a + b, 0)).toBeCloseTo(duration, 2);
    }
  });

  it('maps the codec to a segment format', () => {
    expect(segmentFormatFor('hevc')).toBe('fmp4');
    expect(segmentFormatFor('h264')).toBe('mpegts');
    expect(segmentCount(4)).toBe(1);
    expect(segmentCount(4.0001)).toBe(2);
  });
});

describe('parseHlsFileName', () => {
  it('accepts only the known HLS file names', () => {
    expect(parseHlsFileName('index.m3u8')).toEqual({ kind: 'master' });
    expect(parseHlsFileName('video.m3u8')).toEqual({ kind: 'playlist' });
    expect(parseHlsFileName('init.mp4')).toEqual({ kind: 'init' });
    expect(parseHlsFileName('seg-12.m4s')).toEqual({ kind: 'segment', index: 12, extension: 'm4s' });
    expect(parseHlsFileName('seg-0.ts')).toEqual({ kind: 'segment', index: 0, extension: 'ts' });
    for (const bad of [
      '../index.m3u8',
      'seg-1.mp4',
      'seg-.ts',
      'seg-1.ts.tmp',
      'enc.m3u8',
      'init-ready.mp4',
      'seg-99999999.ts',
    ]) {
      expect(parseHlsFileName(bad)).toBeNull();
    }
  });

  it('maps files to content types', () => {
    expect(contentTypeFor({ kind: 'master' })).toBe('application/vnd.apple.mpegurl');
    expect(contentTypeFor({ kind: 'playlist' })).toBe('application/vnd.apple.mpegurl');
    expect(contentTypeFor({ kind: 'init' })).toBe('video/mp4');
    expect(contentTypeFor({ kind: 'segment', index: 0, extension: 'ts' })).toBe('video/mp2t');
    expect(contentTypeFor({ kind: 'segment', index: 0, extension: 'm4s' })).toBe('video/mp4');
  });
});
