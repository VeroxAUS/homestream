import { describe, expect, it } from 'vitest';
import {
  imageUrl,
  normalizeImageBase,
  normalizeList,
  normalizeMovie,
  normalizeSearch,
  normalizeSeason,
  normalizeShow,
  normalizeSummary,
  yearFrom,
} from '../../src/tmdb/normalize.js';
import { CONFIGURATION, MOVIE_DETAILS, SEARCH_MULTI, SEASON_ONE, SHOW_DETAILS } from './fixtures.js';

const images = { baseUrl: normalizeImageBase(CONFIGURATION) };

describe('image urls', () => {
  it('builds absolute urls from the configuration base', () => {
    expect(images.baseUrl).toBe('https://image.example.test/t/p/');
    expect(imageUrl(images, 'w342', '/a.jpg')).toBe('https://image.example.test/t/p/w342/a.jpg');
  });

  it.each([null, undefined, '', 5])('returns null for missing path %s', (path) => {
    expect(imageUrl(images, 'w342', path)).toBeNull();
  });

  it('falls back to the public TMDB base and adds a trailing slash', () => {
    expect(normalizeImageBase({})).toBe('https://image.tmdb.org/t/p/');
    expect(normalizeImageBase({ images: { secure_base_url: 'https://x.test/p' } })).toBe('https://x.test/p/');
  });
});

describe('yearFrom', () => {
  it.each([
    ['1994-09-23', 1994],
    ['2008', 2008],
    ['', null],
    [undefined, null],
    ['n/a', null],
  ])('%s -> %s', (input, expected) => {
    expect(yearFrom(input)).toBe(expected);
  });
});

describe('normalizeSummary', () => {
  it('maps a movie row', () => {
    expect(normalizeSummary(MOVIE_DETAILS, 'movie', images)).toEqual({
      type: 'movie',
      tmdbId: 278,
      title: 'Movie 278',
      year: 1994,
      overview: 'A movie.',
      posterUrl: 'https://image.example.test/t/p/w342/poster278.jpg',
      backdropUrl: 'https://image.example.test/t/p/w1280/back278.jpg',
      rating: 8.7,
    });
  });

  it('uses name / first_air_date for shows and keeps missing artwork null', () => {
    const show = normalizeSummary(SHOW_DETAILS, 'tv', images);
    expect(show).toMatchObject({ type: 'tv', title: 'Show 1396', year: 2008, backdropUrl: null });
  });

  it('rejects rows without a numeric id', () => {
    expect(normalizeSummary({ title: 'x' }, 'movie', images)).toBeNull();
    expect(normalizeSummary(null, 'movie', images)).toBeNull();
  });

  it('defaults rating and overview when absent', () => {
    expect(normalizeSummary({ id: 1, title: 'T' }, 'movie', images)).toMatchObject({
      rating: 0,
      overview: '',
      year: null,
    });
  });
});

describe('lists and search', () => {
  it('normalizes list rows with the requested type', () => {
    const rows = normalizeList({ results: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }, {}] }, 'movie', images);
    expect(rows.map((row) => row.tmdbId)).toEqual([1, 2]);
    expect(rows.every((row) => row.type === 'movie')).toBe(true);
  });

  it('drops people and unknown media types from multi search', () => {
    const rows = normalizeSearch(SEARCH_MULTI, images);
    expect(rows.map((row) => [row.type, row.tmdbId])).toEqual([
      ['tv', 1396],
      ['movie', 13],
    ]);
  });

  it('tolerates a malformed payload', () => {
    expect(normalizeSearch(null, images)).toEqual([]);
    expect(normalizeList({ results: 'nope' }, 'tv', images)).toEqual([]);
  });
});

describe('details', () => {
  it('maps movie details with imdbId, runtime and genres', () => {
    expect(normalizeMovie(MOVIE_DETAILS, images)).toMatchObject({
      type: 'movie',
      tmdbId: 278,
      runtime: 142,
      genres: ['Drama', 'Crime'],
      imdbId: 'tt0111161',
      originalLanguage: 'en',
    });
  });

  it('nulls a zero runtime and a malformed imdb id', () => {
    const movie = normalizeMovie({ id: 5, title: 'x', runtime: 0, external_ids: { imdb_id: '' } }, images);
    expect(movie).toMatchObject({ runtime: null, imdbId: null, genres: [], originalLanguage: null });
  });

  it('maps show details, sorts seasons and drops specials', () => {
    const show = normalizeShow(SHOW_DETAILS, images);
    expect(show?.imdbId).toBe('tt0903747');
    expect(show?.originalLanguage).toBe('en');
    expect(show?.seasons).toEqual([
      { seasonNumber: 1, name: 'Season 1', episodeCount: 7, posterUrl: 'https://image.example.test/t/p/w342/s1.jpg' },
      { seasonNumber: 2, name: 'Season 2', episodeCount: 13, posterUrl: 'https://image.example.test/t/p/w342/s2.jpg' },
    ]);
  });

  it('maps season episodes in order with w300 stills', () => {
    const season = normalizeSeason(SEASON_ONE, images);
    expect(season?.episodes.map((episode) => episode.episodeNumber)).toEqual([1, 2]);
    expect(season?.episodes[0]).toEqual({
      episodeNumber: 1,
      name: 'Pilot',
      overview: 'One.',
      stillUrl: null,
      runtime: null,
      airDate: null,
    });
    expect(season?.episodes[1]?.stillUrl).toBe('https://image.example.test/t/p/w300/e2.jpg');
  });
});
