import { StreamsQuerySchema, type StreamsResponse } from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { invalidRequest } from '../errors.js';
import { parseId } from './params.js';

const NO_STREAMS: StreamsResponse = { streams: [], recommendedId: null, reason: 'no_streams' };

export function registerStreamRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { tmdb, streams } = ctx;

  function deviceIdFrom(query: unknown): string | undefined {
    const parsed = StreamsQuerySchema.safeParse(query);
    if (!parsed.success) throw invalidRequest(parsed.error);
    return parsed.data.deviceId;
  }

  app.get<{ Params: { tmdbId: string } }>('/api/streams/movie/:tmdbId', async (request): Promise<StreamsResponse> => {
    const tmdbId = parseId(request.params.tmdbId, 'tmdbId', 1);
    const deviceId = deviceIdFrom(request.query);
    const { imdbId } = await tmdb.movie(tmdbId);
    if (!imdbId) return NO_STREAMS;
    return streams.list({ type: 'movie', imdbId }, deviceId);
  });

  app.get<{ Params: { tmdbId: string; season: string; episode: string } }>(
    '/api/streams/tv/:tmdbId/:season/:episode',
    async (request): Promise<StreamsResponse> => {
      const tmdbId = parseId(request.params.tmdbId, 'tmdbId', 1);
      const season = parseId(request.params.season, 'season', 0);
      const episode = parseId(request.params.episode, 'episode', 1);
      const deviceId = deviceIdFrom(request.query);
      const { imdbId } = await tmdb.show(tmdbId);
      if (!imdbId) return NO_STREAMS;
      return streams.list({ type: 'tv', imdbId, season, episode }, deviceId);
    },
  );
}
