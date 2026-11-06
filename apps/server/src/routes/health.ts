import { LogsQuerySchema, type HealthResponse, type LogsResponse } from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { invalidRequest } from '../errors.js';
import { queryEvents } from '../events/query.js';

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async (): Promise<HealthResponse> => ctx.health.get());

  app.post('/api/health/run', async (request): Promise<HealthResponse> => {
    const fresh = (request.query as { fresh?: string } | undefined)?.fresh;
    return ctx.health.run('manual', fresh === '1' || fresh === 'true');
  });

  app.get('/api/logs', async (request): Promise<LogsResponse> => {
    const parsed = LogsQuerySchema.safeParse(request.query);
    if (!parsed.success) throw invalidRequest(parsed.error);
    return { events: queryEvents(ctx.db, parsed.data) };
  });
}
