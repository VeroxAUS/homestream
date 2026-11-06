import type { ContinueWatchingItem, MediaSummary } from '@homestream/shared';
import { describe, expect, it } from 'vitest';
import { buildFeatured, type FeaturedInput } from '../../src/home/featured.js';

function media(type: 'movie' | 'tv', tmdbId: number, overrides: Partial<MediaSummary> = {}): MediaSummary {
  return {
    type,
    tmdbId,
    title: `${type} ${tmdbId}`,
    year: 2020,
    overview: `About ${tmdbId}.`,
    posterUrl: `https://img.test/w342/${tmdbId}.jpg`,
    backdropUrl: `https://img.test/w1280/${tmdbId}.jpg`,
    rating: 7,
    ...overrides,
  };
}

const list = (type: 'movie' | 'tv', first: number, count = 5) =>
  Array.from({ length: count }, (_, i) => media(type, first + i));

function input(overrides: Partial<FeaturedInput> = {}): FeaturedInput {
  return {
    trendingMovies: list('movie', 1),
    trendingShows: list('tv', 100),
    popularMovies: list('movie', 200),
    popularShows: list('tv', 300),
    continueWatching: [],
    because: null,
    played: new Set(),
    ...overrides,
  };
}

const cw = (type: 'movie' | 'tv', tmdbId: number): ContinueWatchingItem => ({
  mediaKey: type === 'movie' ? `movie:${tmdbId}` : `tv:${tmdbId}:1:1`,
  type,
  tmdbId,
  title: 'x',
  posterUrl: null,
  backdropUrl: null,
  positionSec: 100,
  durationSec: 1000,
  upNext: false,
  updatedAt: 1,
});

const base = { mediaType: 'movie' as const, tmdbId: 278, title: 'The Shawshank Redemption' };

describe('buildFeatured', () => {
  it('without history gives four items in slot order', () => {
    const featured = buildFeatured(input());
    expect(featured.map((item) => [item.reason, item.mediaType, item.tmdbId])).toEqual([
      ['trending', 'movie', 1],
      ['trending_show', 'tv', 100],
      ['popular', 'movie', 200],
      ['popular', 'tv', 300],
    ]);
    expect(featured.map((item) => item.reasonLabel)).toEqual([
      'Trending this week',
      'Trending show this week',
      'Popular right now',
      'Popular show',
    ]);
    expect(featured.some((item) => item.basedOn)).toBe(false);
  });

  it('adds a "Because you watched" item second when recommendations exist', () => {
    const featured = buildFeatured(
      input({
        because: { base, recommendations: [media('movie', 500), media('movie', 501)] },
        played: new Set(['movie:278']),
      }),
    );
    expect(featured).toHaveLength(5);
    expect(featured[1]).toMatchObject({
      reason: 'because_you_watched',
      reasonLabel: 'Because you watched The Shawshank Redemption',
      tmdbId: 500,
      basedOn: base,
    });
  });

  it('skips recommendations that are the base title, played, in Continue Watching, or lack a backdrop or overview', () => {
    const recommendations = [
      media('movie', 278),
      media('movie', 301),
      media('movie', 302),
      media('movie', 303, { backdropUrl: null }),
      media('movie', 304, { overview: '  ' }),
      media('movie', 305),
    ];
    const featured = buildFeatured(
      input({
        because: { base, recommendations },
        played: new Set(['movie:278', 'movie:301']),
        continueWatching: [cw('movie', 302)],
      }),
    );
    expect(featured.find((item) => item.reason === 'because_you_watched')?.tmdbId).toBe(305);
  });

  it('omits the slot when nothing usable is recommended', () => {
    const featured = buildFeatured(
      input({ because: { base, recommendations: [media('movie', 278)] }, played: new Set(['movie:278']) }),
    );
    expect(featured.map((item) => item.reason)).not.toContain('because_you_watched');
    expect(featured).toHaveLength(4);
  });

  it('never repeats a title across slots', () => {
    const featured = buildFeatured(
      input({ because: { base, recommendations: [media('movie', 1), media('movie', 200)] } }),
    );
    const keys = featured.map((item) => `${item.mediaType}:${item.tmdbId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(featured.find((item) => item.reason === 'because_you_watched')?.tmdbId).toBe(200);
    expect(featured.find((item) => item.reason === 'popular' && item.mediaType === 'movie')?.tmdbId).toBe(201);
  });

  it('skips Continue Watching titles; an episode blocks its show', () => {
    const featured = buildFeatured(input({ continueWatching: [cw('movie', 1), cw('tv', 100)] }));
    expect(featured.map((item) => item.tmdbId)).toEqual([2, 101, 200, 300]);
  });

  it('takes the first usable title of a list when the head lacks a backdrop or overview', () => {
    const featured = buildFeatured(
      input({
        trendingMovies: [
          media('movie', 1, { backdropUrl: null }),
          media('movie', 2, { overview: '' }),
          media('movie', 3),
        ],
      }),
    );
    expect(featured[0]).toMatchObject({ reason: 'trending', tmdbId: 3 });
  });

  it('backfills to at least three items from the lists', () => {
    const featured = buildFeatured(
      input({ trendingShows: [], popularMovies: [], popularShows: [], trendingMovies: list('movie', 1, 6) }),
    );
    expect(featured.map((item) => item.tmdbId)).toEqual([1, 2, 3]);
    expect(featured.every((item) => item.reason === 'trending')).toBe(true);
  });

  it('uses Continue Watching titles only when fewer than three others exist', () => {
    const featured = buildFeatured(
      input({
        trendingMovies: list('movie', 1, 2),
        trendingShows: [],
        popularMovies: [],
        popularShows: [],
        continueWatching: [cw('movie', 1)],
      }),
    );
    expect(featured.map((item) => item.tmdbId).sort()).toEqual([1, 2]);
  });

  it('never exceeds five items and returns an empty list when TMDB gave nothing', () => {
    expect(
      buildFeatured(input({ because: { base, recommendations: list('movie', 700, 9) } })).length,
    ).toBeLessThanOrEqual(5);
    expect(
      buildFeatured(input({ trendingMovies: [], trendingShows: [], popularMovies: [], popularShows: [] })),
    ).toEqual([]);
  });

  it('fills every field and omits logoUrl', () => {
    const [first] = buildFeatured(input());
    expect(first).toEqual({
      mediaType: 'movie',
      tmdbId: 1,
      title: 'movie 1',
      overview: 'About 1.',
      backdropUrl: 'https://img.test/w1280/1.jpg',
      reason: 'trending',
      reasonLabel: 'Trending this week',
    });
  });
});
