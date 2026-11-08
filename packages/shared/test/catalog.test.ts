import { describe, expect, it } from 'vitest';
import {
  HomeResponseSchema,
  MovieDetailsSchema,
  SearchQuerySchema,
  SeasonSchema,
  ShowDetailsSchema,
} from '../src/index.js';

const summary = {
  tmdbId: 1,
  title: 'T',
  year: null,
  overview: '',
  posterUrl: null,
  backdropUrl: null,
  rating: 7.5,
};

describe('catalog schemas', () => {
  it('accepts movie and show details', () => {
    expect(
      MovieDetailsSchema.safeParse({
        ...summary,
        type: 'movie',
        runtime: 90,
        genres: ['Drama'],
        imdbId: 'tt1',
        originalLanguage: 'en',
      }).success,
    ).toBe(true);
    expect(
      ShowDetailsSchema.safeParse({
        ...summary,
        type: 'tv',
        genres: [],
        imdbId: null,
        originalLanguage: null,
        seasons: [{ seasonNumber: 1, name: 'S1', episodeCount: 7, posterUrl: null }],
      }).success,
    ).toBe(true);
  });

  it('carries cast and similar, and defaults both to empty for an older server', () => {
    const movie = {
      ...summary,
      type: 'movie' as const,
      runtime: 90,
      genres: [],
      imdbId: null,
      originalLanguage: null,
    };
    const cast = [{ name: 'Tim Robbins', character: 'Andy Dufresne', profileUrl: null }];
    const similar = [{ ...summary, type: 'movie' as const, tmdbId: 2 }];
    expect(MovieDetailsSchema.parse({ ...movie, cast, similar })).toMatchObject({ cast, similar });
    expect(MovieDetailsSchema.parse(movie)).toMatchObject({ cast: [], similar: [] });
    const show = { ...summary, type: 'tv' as const, genres: [], imdbId: null, originalLanguage: null, seasons: [] };
    expect(ShowDetailsSchema.parse(show)).toMatchObject({ cast: [], similar: [] });
    expect(ShowDetailsSchema.parse({ ...show, cast, similar })).toMatchObject({ cast, similar });
  });

  it('rejects more than 15 cast members, more than 20 similar titles and a nameless member', () => {
    const movie = { ...summary, type: 'movie' as const, runtime: 90, genres: [], imdbId: null, originalLanguage: null };
    const member = { name: 'A', character: '', profileUrl: null };
    expect(MovieDetailsSchema.safeParse({ ...movie, cast: Array(16).fill(member) }).success).toBe(false);
    expect(MovieDetailsSchema.safeParse({ ...movie, cast: Array(15).fill(member) }).success).toBe(true);
    expect(MovieDetailsSchema.safeParse({ ...movie, cast: [{ ...member, name: '' }] }).success).toBe(false);
    const item = { ...summary, type: 'movie' as const };
    expect(MovieDetailsSchema.safeParse({ ...movie, similar: Array(21).fill(item) }).success).toBe(false);
  });

  it('rejects a movie typed as tv', () => {
    expect(MovieDetailsSchema.safeParse({ ...summary, type: 'tv', runtime: 1, genres: [], imdbId: null }).success).toBe(
      false,
    );
  });

  it('accepts a season with episodes and a home response', () => {
    const episode = { episodeNumber: 1, name: 'Pilot', overview: '', stillUrl: null, runtime: null, airDate: null };
    expect(SeasonSchema.safeParse({ seasonNumber: 1, name: 'S1', episodes: [episode] }).success).toBe(true);
    const empty = {
      continueWatching: [],
      featured: [],
      trendingMovies: [],
      trendingShows: [],
      popularMovies: [],
      popularShows: [],
    };
    expect(HomeResponseSchema.safeParse(empty).success).toBe(true);
  });

  it.each([undefined, '', '   ', 5])('rejects search query %j', (q) => {
    expect(SearchQuerySchema.safeParse({ q }).success).toBe(false);
  });

  it('trims the search query', () => {
    expect(SearchQuerySchema.parse({ q: '  dune ' }).q).toBe('dune');
  });
});
