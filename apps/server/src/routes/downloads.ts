import type { DownloadsResponse } from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { AppError } from '../errors.js';

export function registerDownloadRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { downloads } = ctx;

  app.get('/api/downloads', async (): Promise<DownloadsResponse> => ({ downloads: downloads.list() }));

  app.delete<{ Params: { id: string } }>('/api/downloads/:id', async (request) => {
    if (!downloads.cancel(request.params.id)) {
      throw new AppError(
        404,
        'not_found',
        'No such download.',
        'List the downloads with GET /api/downloads and use one of the ids shown there.',
      );
    }
    return { id: request.params.id, state: 'cancelled' };
  });
}
