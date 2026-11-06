import {
  SearchQuerySchema,
  type HomeResponse,
  type MovieDetailsWithDownload,
  type Season,
  type SearchResponse,
  type ShowDetailsWithDownloads,
} from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { AppError } from '../errors.js';
import { parseId } from './params.js';

export function registerCatalogRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { tmdb } = ctx;

  app.get('/api/home', async (): Promise<HomeResponse> => ctx.home.home());

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

  app.get<{ Params: { tmdbId: string } }>('/api/movie/:tmdbId', async (request): Promise<MovieDetailsWithDownload> => {
    const tmdbId = parseId(request.params.tmdbId, 'tmdbId', 1);
    const details = await tmdb.movie(tmdbId);
    const download = ctx.downloads.forMovie(tmdbId);
    return download ? { ...details, download } : details;
  });

  app.get<{ Params: { tmdbId: string } }>('/api/tv/:tmdbId', async (request): Promise<ShowDetailsWithDownloads> => {
    const tmdbId = parseId(request.params.tmdbId, 'tmdbId', 1);
    const details = await tmdb.show(tmdbId);
    const downloads = ctx.downloads.forShow(tmdbId);
    return downloads.length > 0 ? { ...details, downloads } : details;
  });

  app.get<{ Params: { tmdbId: string; n: string } }>('/api/tv/:tmdbId/season/:n', async (request): Promise<Season> => {
    const tmdbId = parseId(request.params.tmdbId, 'tmdbId', 1);
    const seasonNumber = parseId(request.params.n, 'season number', 0);
    return tmdb.season(tmdbId, seasonNumber);
  });
}
