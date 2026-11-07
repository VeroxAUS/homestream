import { describe, expect, it } from 'vitest';
import {
  MIN_LISTED_BYTES_FOR_SIZE_CHECK,
  clipSizeImplausible,
  placeholderName,
  redirectShape,
} from '../../src/playback/placeholder.js';

const BASE = 'https://gw.example.test/api/v1/debrid/playback/tok-secret/Movie.mkv';
const MB = 1024 * 1024;

describe('placeholderName', () => {
  it.each([
    ['same host, absolute', 'https://gw.example.test/static/downloading.mp4', 'downloading'],
    ['other host, absolute', 'https://cdn.example.test/static/downloading.mp4', 'downloading'],
    ['relative path', '/static/store_limit_exceeded.mp4', 'store_limit_exceeded'],
    ['relative with a query string', '/static/downloading.mp4?v=3&sig=abc', 'downloading'],
    ['upper-case name and extension', '/static/Downloading.MP4', 'downloading'],
    ['numeric clip', '/static/429.mp4', '429'],
    ['behind a path prefix', '/stremio/static/downloading.mp4', 'downloading'],
  ])('recognises %s', (_label, location, name) => {
    expect(placeholderName(new URL(location, BASE))).toBe(name);
  });

  it.each([
    ['a different folder', '/files/movie.mp4'],
    ['a static file that is not an mp4', '/static/readme.txt'],
    ['an mp4 below static', '/static/clips/downloading.mp4'],
    ['the clip name only in the query', '/api/file.mkv?path=/static/downloading.mp4'],
    ['a name that merely ends with static', '/mystatic/downloading.mp4'],
  ])('leaves %s alone', (_label, location) => {
    expect(placeholderName(new URL(location, BASE))).toBeNull();
  });
});

describe('clipSizeImplausible', () => {
  it('flags a file below 10% of a listed size of at least 20 MB', () => {
    expect(clipSizeImplausible(2_000_000_000, 4 * MB)).toBe(true);
    expect(clipSizeImplausible(50 * MB, 4 * MB)).toBe(true);
  });

  it('passes a file near its listed size, also when the listing is off by a lot', () => {
    expect(clipSizeImplausible(2_000_000_000, 1_999_000_000)).toBe(false);
    expect(clipSizeImplausible(2_000_000_000, 400_000_000)).toBe(false);
    expect(clipSizeImplausible(2_000_000_000, 0.1 * 2_000_000_000)).toBe(false);
  });

  it('never flags a short real title that lists a small size', () => {
    expect(MIN_LISTED_BYTES_FOR_SIZE_CHECK).toBe(20 * MB);
    expect(clipSizeImplausible(19 * MB, 1 * MB)).toBe(false);
    expect(clipSizeImplausible(8 * MB, 8 * MB)).toBe(false);
  });

  it('does not judge when either size is unknown', () => {
    expect(clipSizeImplausible(0, 4 * MB)).toBe(false);
    expect(clipSizeImplausible(2_000_000_000, 0)).toBe(false);
    expect(clipSizeImplausible(2_000_000_000, null)).toBe(false);
    expect(clipSizeImplausible(Number.NaN, 4 * MB)).toBe(false);
  });
});

describe('redirectShape', () => {
  it('describes host class, path pattern and status without any part of the URL', () => {
    const shape = redirectShape(307, new URL('https://cdn.example.test/static/downloading.mp4?sig=abc', BASE), BASE);
    expect(shape).toEqual({ status: 307, host: 'other', path: '/static/<word>.mp4', query: true });
  });

  it('classifies a relative location as the same host', () => {
    expect(redirectShape(302, new URL('/hop/42?x=1', BASE), BASE)).toEqual({
      status: 302,
      host: 'same',
      path: '/<word>/<num>',
      query: true,
    });
  });

  it('keeps token-like segments out of the pattern', () => {
    const shape = redirectShape(
      307,
      new URL('https://tok-secret.example.test/webdl/0a1b2c3d4e5f6a7b8c9d/Some.Movie.2020.1080p.mkv?token=zzz', BASE),
      BASE,
    );
    const text = JSON.stringify(shape);
    expect(shape.host).toBe('other');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('Some.Movie');
    expect(text).not.toContain('0a1b2c3d4e5f6a7b8c9d');
    expect(text).not.toContain('zzz');
    expect(shape.path).toBe('/<word>/<id>/<name>.mkv');
  });
});
