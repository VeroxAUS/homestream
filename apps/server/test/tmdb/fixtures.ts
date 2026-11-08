import type { FetchLike } from '../../src/tmdb/service.js';

export const CONFIGURATION = { images: { secure_base_url: 'https://image.example.test/t/p/' } };

const movieRow = (id: number) => ({
  id,
  title: `Movie ${id}`,
  overview: 'A movie.',
  release_date: '1994-09-23',
  poster_path: `/poster${id}.jpg`,
  backdrop_path: `/back${id}.jpg`,
  vote_average: 8.7123,
});

const tvRow = (id: number) => ({
  id,
  name: `Show ${id}`,
  overview: 'A show.',
  first_air_date: '2008-01-20',
  poster_path: `/poster${id}.jpg`,
  backdrop_path: null,
  vote_average: 8.9,
});

export const MOVIE_DETAILS = {
  ...movieRow(278),
  runtime: 142,
  original_language: 'en',
  genres: [
    { id: 18, name: 'Drama' },
    { id: 80, name: 'Crime' },
  ],
  external_ids: { imdb_id: 'tt0111161' },
  credits: {
    cast: [
      { id: 504, name: 'Tim Robbins', character: 'Andy Dufresne', order: 0, profile_path: '/tim.jpg' },
      { id: 192, name: 'Morgan Freeman', character: "Ellis Boyd 'Red' Redding", order: 1, profile_path: null },
    ],
  },
  recommendations: { results: [movieRow(238), movieRow(278), movieRow(424)] },
  similar: { results: [movieRow(11), movieRow(12)] },
};

export const SHOW_DETAILS = {
  ...tvRow(1396),
  genres: [{ id: 18, name: 'Drama' }],
  original_language: 'en',
  external_ids: { imdb_id: 'tt0903747' },
  aggregate_credits: {
    cast: [
      {
        id: 17419,
        name: 'Bryan Cranston',
        order: 0,
        profile_path: '/bryan.jpg',
        roles: [{ character: 'Walter White', episode_count: 62 }],
      },
      { id: 84497, name: 'Aaron Paul', order: 1, profile_path: null, roles: [{ character: 'Jesse Pinkman' }] },
    ],
  },
  recommendations: { results: [] },
  similar: { results: [tvRow(1398), tvRow(1396)] },
  seasons: [
    { season_number: 2, name: 'Season 2', episode_count: 13, poster_path: '/s2.jpg' },
    { season_number: 0, name: 'Specials', episode_count: 9, poster_path: null },
    { season_number: 1, name: 'Season 1', episode_count: 7, poster_path: '/s1.jpg' },
  ],
};

export const SEASON_ONE = {
  season_number: 1,
  name: 'Season 1',
  episodes: [
    {
      episode_number: 2,
      name: 'Cat in the Bag',
      overview: 'Two.',
      still_path: '/e2.jpg',
      runtime: 48,
      air_date: '2008-01-27',
    },
    { episode_number: 1, name: 'Pilot', overview: 'One.', still_path: null, runtime: 0, air_date: '' },
  ],
};

export const SEARCH_MULTI = {
  results: [
    { media_type: 'person', id: 31, name: 'Tom Hanks', known_for: [] },
    { ...tvRow(1396), media_type: 'tv' },
    { ...movieRow(13), media_type: 'movie' },
  ],
};

export interface FakeTmdb {
  fetch: FetchLike;
  calls: string[];
  failWith?: { status: number } | 'network';
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function makeFakeTmdb(): FakeTmdb {
  const fake: FakeTmdb = {
    calls: [],
    fetch: async (url, init) => {
      const parsed = new URL(url);
      fake.calls.push(`${parsed.pathname}${parsed.search}`);
      if (init.headers.Authorization !== 'Bearer tmdb-test-token-123456') return json({ status_code: 7 }, 401);
      if (fake.failWith === 'network') throw new TypeError('fetch failed');
      if (fake.failWith) return json({}, fake.failWith.status);
      const path = parsed.pathname.replace(/^\/3/, '');
      const list = (row: (id: number) => unknown) =>
        json({ results: Array.from({ length: 12 }, (_, i) => row(i + 1)) });
      if (path === '/configuration') return json(CONFIGURATION);
      if (path === '/trending/movie/week' || path === '/movie/popular') return list(movieRow);
      if (path === '/trending/tv/week' || path === '/tv/popular') return list(tvRow);
      if (path === '/search/multi') return json(SEARCH_MULTI);
      if (path === '/movie/278') return json(MOVIE_DETAILS);
      if (path === '/movie/604') return json(movieRow(604));
      if (path === '/tv/1396') return json(SHOW_DETAILS);
      if (path === '/tv/1396/season/1') return json(SEASON_ONE);
      return json({ status_code: 34 }, 404);
    },
  };
  return fake;
}
