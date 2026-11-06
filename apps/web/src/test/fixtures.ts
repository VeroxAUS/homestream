import type {
  ContinueWatchingItem,
  Download,
  Episode,
  FeaturedItem,
  HealthCheck,
  HealthResponse,
  HomeResponse,
  MediaSummary,
  MovieDetailsWithDownload,
  ProgressResponse,
  Season,
  ServerInfo,
  ShowDetailsWithDownloads,
} from '@homestream/shared';

const POSTER = 'https://image.tmdb.org/t/p/w342/poster.jpg';
const BACKDROP = 'https://image.tmdb.org/t/p/w1280/backdrop.jpg';

export function media(overrides: Partial<MediaSummary> = {}): MediaSummary {
  return {
    type: 'movie',
    tmdbId: 278,
    title: 'The Shawshank Redemption',
    year: 1994,
    overview: 'Two imprisoned men bond over a number of years.',
    posterUrl: POSTER,
    backdropUrl: BACKDROP,
    rating: 8.7,
    ...overrides,
  };
}

export function show(overrides: Partial<MediaSummary> = {}): MediaSummary {
  return media({ type: 'tv', tmdbId: 1396, title: 'Breaking Bad', year: 2008, ...overrides });
}

export function featured(overrides: Partial<FeaturedItem> = {}): FeaturedItem {
  return {
    mediaType: 'movie',
    tmdbId: 278,
    title: 'The Shawshank Redemption',
    overview: 'Two imprisoned men bond over a number of years.',
    backdropUrl: BACKDROP,
    reason: 'trending',
    reasonLabel: 'Trending this week',
    ...overrides,
  };
}

export function continueWatching(overrides: Partial<ContinueWatchingItem> = {}): ContinueWatchingItem {
  return {
    mediaKey: 'movie:278',
    type: 'movie',
    tmdbId: 278,
    title: 'The Shawshank Redemption',
    posterUrl: POSTER,
    backdropUrl: BACKDROP,
    positionSec: 3000,
    durationSec: 8520,
    upNext: false,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

export function home(overrides: Partial<HomeResponse> = {}): HomeResponse {
  const movies = (offset: number) =>
    Array.from({ length: 3 }, (_, index) => media({ tmdbId: offset + index, title: `Movie ${offset + index}` }));
  const shows = (offset: number) =>
    Array.from({ length: 3 }, (_, index) => show({ tmdbId: offset + index, title: `Show ${offset + index}` }));
  return {
    continueWatching: [],
    featured: [featured()],
    trendingMovies: movies(100),
    trendingShows: shows(200),
    popularMovies: movies(300),
    popularShows: shows(400),
    ...overrides,
  };
}

export function movieDetails(overrides: Partial<MovieDetailsWithDownload> = {}): MovieDetailsWithDownload {
  return {
    type: 'movie',
    tmdbId: 278,
    title: 'The Shawshank Redemption',
    year: 1994,
    overview: 'Two imprisoned men bond over a number of years.',
    posterUrl: POSTER,
    backdropUrl: BACKDROP,
    rating: 8.7,
    runtime: 142,
    genres: ['Drama', 'Crime'],
    imdbId: 'tt0111161',
    originalLanguage: 'en',
    ...overrides,
  };
}

export function showDetails(overrides: Partial<ShowDetailsWithDownloads> = {}): ShowDetailsWithDownloads {
  return {
    type: 'tv',
    tmdbId: 1396,
    title: 'Breaking Bad',
    year: 2008,
    overview: 'A chemistry teacher turns to crime.',
    posterUrl: POSTER,
    backdropUrl: BACKDROP,
    rating: 8.9,
    genres: ['Drama'],
    imdbId: 'tt0903747',
    originalLanguage: 'en',
    seasons: [
      { seasonNumber: 0, name: 'Specials', episodeCount: 2, posterUrl: null },
      { seasonNumber: 1, name: 'Season 1', episodeCount: 3, posterUrl: null },
      { seasonNumber: 2, name: 'Season 2', episodeCount: 2, posterUrl: null },
    ],
    ...overrides,
  };
}

export function episode(number: number, overrides: Partial<Episode> = {}): Episode {
  return {
    episodeNumber: number,
    name: `Episode title ${number}`,
    overview: `What happens in episode ${number}.`,
    stillUrl: `https://image.tmdb.org/t/p/w300/still${number}.jpg`,
    runtime: 47,
    airDate: '2008-01-20',
    ...overrides,
  };
}

export function season(seasonNumber: number, count: number): Season {
  return {
    seasonNumber,
    name: seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`,
    episodes: Array.from({ length: count }, (_, index) => episode(index + 1)),
  };
}

export function progress(overrides: Partial<ProgressResponse> = {}): ProgressResponse {
  return {
    mediaKey: 'movie:278',
    positionSec: 3722,
    durationSec: 8520,
    completed: false,
    resumable: true,
    ...overrides,
  };
}

export function download(overrides: Partial<Download> = {}): Download {
  return {
    id: 'd1',
    mediaType: 'movie',
    tmdbId: 278,
    title: 'The Shawshank Redemption',
    state: 'downloading',
    status: 'pending',
    progress: 0.42,
    startedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function healthCheck(overrides: Partial<HealthCheck> = {}): HealthCheck {
  return {
    id: 'gateway',
    name: 'Stream gateway',
    status: 'ok',
    message: 'Fine',
    latencyMs: 10,
    checkedAt: '2026-01-01T00:00:00.000Z',
    details: {},
    ...overrides,
  };
}

export function health(overall: HealthResponse['overall'], statuses: HealthCheck['status'][] = []): HealthResponse {
  return {
    overall,
    checks: statuses.map((status, index) =>
      healthCheck({ id: index === 0 ? 'gateway' : 'tmdb', name: `Check ${index}`, status }),
    ),
  };
}

export const INFO: ServerInfo = {
  app: 'homestream',
  name: 'Test PC',
  version: '1.2.3',
  port: 8600,
  lanAddresses: ['192.168.1.50'],
};
