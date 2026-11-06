import type { FetchLike } from '../../src/tmdb/service.js';
import { makeFakeTmdb, MOVIE_DETAILS, SHOW_DETAILS } from '../tmdb/fixtures.js';

/** Episodes per season of Breaking Bad, as TMDB lists them. */
export const BREAKING_BAD_SEASONS: Record<number, number> = { 1: 7, 2: 13, 3: 13, 4: 13, 5: 16 };

const movie = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Movie ${id}`,
  overview: `Overview of movie ${id}.`,
  release_date: '2010-01-01',
  poster_path: `/poster${id}.jpg`,
  backdrop_path: `/back${id}.jpg`,
  vote_average: 7.5,
  ...extra,
});

export interface FakeCatalog {
  fetch: FetchLike;
  calls: string[];
  /** Recommendation requests answer 502 while set. */
  failRecommendations: boolean;
}

/**
 * The base fake TMDB plus the complete Breaking Bad season list, Dune, and recommendations for movie 278 and show 1396.
 * Movie 100 is "unusable" (no backdrop), 101 has no overview, 278 is the base title itself and 102/103 are valid picks.
 */
export function makeFakeCatalog(): FakeCatalog {
  const base = makeFakeTmdb();
  const catalog: FakeCatalog = {
    calls: [],
    failRecommendations: false,
    fetch: async (url, init) => {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/^\/3/, '');
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (path.endsWith('/recommendations')) {
        catalog.calls.push(path);
        if (init.headers.Authorization !== 'Bearer tmdb-test-token-123456') return json({ status_code: 7 }, 401);
        if (catalog.failRecommendations) return json({}, 502);
        if (path === '/movie/278/recommendations') {
          return json({
            results: [
              movie(100, { backdrop_path: null }),
              movie(101, { overview: ' ' }),
              movie(278),
              movie(102),
              movie(103),
            ],
          });
        }
        if (path === '/tv/1396/recommendations') {
          return json({
            results: [
              {
                id: 2000,
                name: 'Better Call Saul',
                overview: 'Saul.',
                first_air_date: '2015-02-08',
                poster_path: '/p.jpg',
                backdrop_path: '/b.jpg',
                vote_average: 8.9,
              },
            ],
          });
        }
        return json({ results: [] });
      }
      if (path === '/tv/1396') {
        const seasons = Object.entries(BREAKING_BAD_SEASONS).map(([n, count]) => ({
          season_number: Number(n),
          name: `Season ${n}`,
          episode_count: count,
          poster_path: `/s${n}.jpg`,
        }));
        return json({ ...SHOW_DETAILS, seasons });
      }
      const season = /^\/tv\/1396\/season\/(\d+)$/.exec(path);
      if (season) {
        catalog.calls.push(path);
        const number = Number(season[1]);
        const count = BREAKING_BAD_SEASONS[number];
        if (!count) return json({ status_code: 34 }, 404);
        return json({
          season_number: number,
          name: `Season ${number}`,
          episodes: Array.from({ length: count }, (_, i) => ({
            episode_number: i + 1,
            name: `S${number}E${i + 1} title`,
            overview: 'An episode.',
            still_path: `/still-${number}-${i + 1}.jpg`,
            runtime: 47,
            air_date: '2010-01-01',
          })),
        });
      }
      if (path === '/movie/693134')
        return json({ ...MOVIE_DETAILS, id: 693134, title: 'Dune: Part Two', external_ids: { imdb_id: 'tt15239678' } });
      catalog.calls.push(path);
      return base.fetch(url, init);
    },
  };
  return catalog;
}
