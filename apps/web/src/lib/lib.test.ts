import type { SeasonSummary } from '@homestream/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { describeError } from './errors';
import {
  formatClock,
  formatEpisodeCode,
  formatEpisodeRuntime,
  formatRemaining,
  formatRuntime,
  watchedFraction,
} from './format';
import { tmdbImage } from './images';
import { orderSeasons, pickSeason, seasonLabel } from './seasons';

function season(seasonNumber: number, episodeCount = 8): SeasonSummary {
  return {
    seasonNumber,
    name: `Season ${seasonNumber}`,
    episodeCount,
    posterUrl: null,
    airDate: null,
  } as SeasonSummary;
}

describe('format', () => {
  it('writes runtimes as hours and minutes', () => {
    expect(formatRuntime(142)).toBe('2h 22m');
    expect(formatRuntime(120)).toBe('2h');
    expect(formatRuntime(45)).toBe('45m');
    expect(formatEpisodeRuntime(47)).toBe('47 min');
  });

  it('writes playback positions as clock times', () => {
    expect(formatClock(125)).toBe('2:05');
    expect(formatClock(3733)).toBe('1:02:13');
    expect(formatClock(-4)).toBe('0:00');
  });

  it('writes the time left', () => {
    expect(formatRemaining(0, 4800)).toBe('1 h 20 min left');
    expect(formatRemaining(1200, 1920)).toBe('12 min left');
    expect(formatRemaining(1990, 2000)).toBe('less than a minute left');
    expect(formatRemaining(5000, 4800)).toBe('less than a minute left');
  });

  it('clamps the watched fraction', () => {
    expect(watchedFraction(50, 200)).toBe(0.25);
    expect(watchedFraction(500, 200)).toBe(1);
    expect(watchedFraction(-5, 200)).toBe(0);
    expect(watchedFraction(10, 0)).toBe(0);
  });

  it('writes episode codes', () => {
    expect(formatEpisodeCode(1, 3)).toBe('S1E3');
  });
});

describe('tmdbImage', () => {
  it('swaps the size segment of a TMDB url', () => {
    expect(tmdbImage('https://image.tmdb.org/t/p/original/abc.jpg', 'w342')).toBe(
      'https://image.tmdb.org/t/p/w342/abc.jpg',
    );
    expect(tmdbImage('https://image.tmdb.org/t/p/w500/abc.jpg', 'w1280')).toBe(
      'https://image.tmdb.org/t/p/w1280/abc.jpg',
    );
  });

  it('leaves other urls alone and returns null for no image', () => {
    expect(tmdbImage('https://example.test/poster.jpg', 'w342')).toBe('https://example.test/poster.jpg');
    expect(tmdbImage(null, 'w342')).toBeNull();
    expect(tmdbImage(undefined, 'w342')).toBeNull();
    expect(tmdbImage('', 'w342')).toBeNull();
  });
});

describe('seasons', () => {
  it('orders numbered seasons first, specials last, and drops empty ones', () => {
    const ordered = orderSeasons([season(0), season(2), season(3, 0), season(1)]);
    expect(ordered.map((entry) => entry.seasonNumber)).toEqual([1, 2, 0]);
  });

  it('labels seasons', () => {
    expect(seasonLabel(season(0))).toBe('Specials');
    expect(seasonLabel(season(4))).toBe('Season 4');
  });

  it('picks the requested season, else the first', () => {
    const seasons = [season(1), season(2)];
    expect(pickSeason('2', seasons)).toBe(2);
    expect(pickSeason('9', seasons)).toBe(1);
    expect(pickSeason('abc', seasons)).toBe(1);
    expect(pickSeason(null, seasons)).toBe(1);
    expect(pickSeason('1', [])).toBeNull();
  });
});

describe('describeError', () => {
  it('passes on the message and hint of an API error', () => {
    expect(describeError(new ApiError(500, 'boom', 'It broke.', 'Restart it.'))).toEqual({
      message: 'It broke.',
      hint: 'Restart it.',
      unreachable: false,
    });
    expect(describeError(new ApiError(404, 'nope', 'Missing.'))).toEqual({ message: 'Missing.', unreachable: false });
  });

  it('treats a network failure or a timeout as an unreachable server', () => {
    expect(describeError(new TypeError('Failed to fetch')).unreachable).toBe(true);
    expect(describeError(new DOMException('slow', 'TimeoutError')).unreachable).toBe(true);
  });

  it('explains an unreadable answer', () => {
    const description = describeError(new Error('schema'));
    expect(description.unreachable).toBe(false);
    expect(description.message).toMatch(/cannot read/);
    expect(description.hint).toMatch(/same version/);
  });
});
