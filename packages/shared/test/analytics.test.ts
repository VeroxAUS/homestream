import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
  isAnalyticsEvent,
  sanitizeEventProperties,
} from '../src/analytics.js';
import { SCRUBBED } from '../src/sanitize.js';

const started = {
  mediaType: 'movie',
  tmdbId: 603,
  title: 'The Matrix',
  deviceKind: 'tv',
  videoCodec: 'hevc',
  hdr: true,
  resolution: '2160p',
  startupMs: 1500,
};

describe('analytics catalog', () => {
  it('declares the documented events', () => {
    expect(ANALYTICS_EVENT_NAMES).toEqual([
      'server_started',
      'playback_started',
      'playback_ended',
      'playback_failed',
      'prefetch_requested',
    ]);
    for (const name of ANALYTICS_EVENT_NAMES) expect(ANALYTICS_EVENTS[name].description.length).toBeGreaterThan(10);
  });

  it('recognises catalog names only', () => {
    expect(isAnalyticsEvent('playback_started')).toBe(true);
    expect(isAnalyticsEvent('toString')).toBe(false);
    expect(isAnalyticsEvent('page_view')).toBe(false);
  });
});

describe('sanitizeEventProperties', () => {
  it('returns null for an event outside the catalog', () => {
    expect(sanitizeEventProperties('page_view', { a: 1 })).toBeNull();
    expect(sanitizeEventProperties('constructor', {})).toBeNull();
  });

  it('keeps the allowlisted properties, titles included, and drops everything else', () => {
    const out = sanitizeEventProperties('playback_started', {
      ...started,
      streamUrl: 'https://example-cdn.tb-cdn.io/dl/9?token=zzzz', // gitleaks:allow
      clientIp: '192.168.1.50',
      filename: 'Movie.2160p.mkv',
    });
    expect(out).toEqual(started);
  });

  it('drops a property whose value fails its type', () => {
    const out = sanitizeEventProperties('playback_started', {
      ...started,
      startupMs: -5,
      resolution: '8k',
      hdr: 'yes',
    });
    expect(out).toEqual({ mediaType: 'movie', tmdbId: 603, title: 'The Matrix', deviceKind: 'tv', videoCodec: 'hevc' });
  });

  it('drops a non-title text value that changes while scrubbing, and scrubs a title that does', () => {
    const out = sanitizeEventProperties('playback_failed', {
      mediaType: 'movie',
      tmdbId: 1,
      title: 'Visit https://example.test/x now',
      deviceKind: 'tv',
      stage: 'start',
      errorCode: 'ok_code',
    });
    expect(out).toEqual({
      mediaType: 'movie',
      tmdbId: 1,
      title: `Visit ${SCRUBBED} now`,
      deviceKind: 'tv',
      stage: 'start',
      errorCode: 'ok_code',
    });
    expect(sanitizeEventProperties('playback_failed', { stage: 'start', errorCode: '192.168.1.50' })).toEqual({
      stage: 'start',
    });
  });

  it('drops a free-form string that scrubbing would change, such as a version that looks like an address', () => {
    expect(sanitizeEventProperties('server_started', { version: '1.2.3.4', os: 'linux' })).toEqual({ os: 'linux' });
  });

  it('applies the extra scrubber to titles', () => {
    const out = sanitizeEventProperties('playback_failed', { title: 'My secret-title', stage: 'start' }, (text) =>
      text.replace('secret-title', 'X'),
    );
    expect(out).toEqual({ title: 'My X', stage: 'start' });
  });

  it('accepts every event with its documented properties', () => {
    expect(
      sanitizeEventProperties('server_started', { version: '1.2.3', os: 'windows', packaged: false, nodeMajor: 24 }),
    ).toEqual({
      version: '1.2.3',
      os: 'windows',
      packaged: false,
      nodeMajor: 24,
    });
    expect(
      sanitizeEventProperties('playback_ended', {
        mediaType: 'tv',
        tmdbId: 1396,
        title: 'Breaking Bad',
        deviceKind: 'web',
        reason: 'idle',
        watchedSec: 90,
        avgSpeed: 2.5,
      }),
    ).toMatchObject({ reason: 'idle', watchedSec: 90, avgSpeed: 2.5 });
    expect(
      sanitizeEventProperties('prefetch_requested', {
        mediaType: 'movie',
        tmdbId: 5,
        deviceKind: 'desktop',
        flagEnabled: false,
      }),
    ).toEqual({ mediaType: 'movie', tmdbId: 5, deviceKind: 'desktop', flagEnabled: false });
  });
});
