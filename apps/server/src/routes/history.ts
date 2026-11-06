import {
  HistoryQuerySchema,
  StatsQuerySchema,
  type HistoryResponse,
  type StatsGraphsResponse,
  type StatsSummaryResponse,
} from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { playsStartedSince, queryHistory, type HistoryFilter } from '../db/history.js';
import { AppError, invalidRequest } from '../errors.js';
import { graphs, summarize, windowStart } from '../stats/aggregate.js';
import { parseTimeBound } from '../stats/timeBound.js';

function bound(name: 'from' | 'to', raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = parseTimeBound(raw, name);
  if (parsed === null) {
    throw new AppError(400, 'invalid_request', `${name}: "${raw.slice(0, 40)}" is not a time.`, 'Use epoch milliseconds, an ISO timestamp or a day like 2026-11-06.');
  }
  return parsed;
}

export function registerHistoryRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/history', async (request): Promise<HistoryResponse> => {
    const parsed = HistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) throw invalidRequest(parsed.error);
    const { page, pageSize, ...rest } = parsed.data;
    const filter: HistoryFilter = {
      type: rest.type,
      deviceId: rest.deviceId,
      q: rest.q,
      from: bound('from', rest.from),
      to: bound('to', rest.to),
    };
    const { items, total } = queryHistory(db, filter, pageSize, (page - 1) * pageSize);
    return { items, total, page, pageSize };
  });

  app.get('/api/stats/summary', async (request): Promise<StatsSummaryResponse> => {
    const parsed = StatsQuerySchema.safeParse(request.query);
    if (!parsed.success) throw invalidRequest(parsed.error);
    const now = Date.now();
    return summarize(playsStartedSince(db, windowStart(now, parsed.data.days)), parsed.data.days, now);
  });

  app.get('/api/stats/graphs', async (request): Promise<StatsGraphsResponse> => {
    const parsed = StatsQuerySchema.safeParse(request.query);
    if (!parsed.success) throw invalidRequest(parsed.error);
    const now = Date.now();
    return graphs(playsStartedSince(db, windowStart(now, parsed.data.days)), parsed.data.days, now);
  });
}
