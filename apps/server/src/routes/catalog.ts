import {
  SearchQuerySchema,
  type HomeResponse,
  type MovieDetails,
  type Season,
  type SearchResponse,
  type ShowDetails,
} from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { AppError } from '../errors.js';

function parseId(raw: string, name: string, min: number): number {
  const value = /^\d{1,15}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min) {
    throw new AppError(
      400,
      'invalid_request',
      `${name} must be a whole number${min > 0 ? ' greater than 0' : ''}, got "${raw.slice(0, 40)}".`,
      'Use the numeric TMDB id, for example /api/movie/278.',
    );
  }
  return value;
}

export function registerCatalogRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { tmdb } = ctx;

  app.get('/api/home', async (): Promise<HomeResponse> => {
    const rows = await tmdb.home();
    return { continueWatching: [], ...rows };
  });

  app.get('/api/search', async (request): Promise<SearchResponse> => {
    const parsed = SearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError(
        400,
        'invalid_request',
        `q: ${issue?.message ?? 'invalid search query'}`,
        'Pass a non-empty search text, for example /api/search?q=dune.',
      );
    }
    return { results: await tmdb.search(parsed.data.q) };
  });

  app.get<{ Params: { tmdbId: string } }>('/api/movie/:tmdbId', async (request): Promise<MovieDetails> => {
    return tmdb.movie(parseId(request.params.tmdbId, 'tmdbId', 1));
  });

  app.get<{ Params: { tmdbId: string } }>('/api/tv/:tmdbId', async (request): Promise<ShowDetails> => {
    return tmdb.show(parseId(request.params.tmdbId, 'tmdbId', 1));
  });

  app.get<{ Params: { tmdbId: string; n: string } }>(
    '/api/tv/:tmdbId/season/:n',
    async (request): Promise<Season> => {
      const tmdbId = parseId(request.params.tmdbId, 'tmdbId', 1);
      const seasonNumber = parseId(request.params.n, 'season number', 0);
      return tmdb.season(tmdbId, seasonNumber);
    },
  );
}
