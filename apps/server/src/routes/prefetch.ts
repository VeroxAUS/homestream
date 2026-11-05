import { PrefetchRequestSchema, type PrefetchResponse } from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { invalidRequest } from '../errors.js';
import { stripIpv6Prefix } from '../net.js';

export function registerPrefetchRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/prefetch', async (request, reply): Promise<PrefetchResponse> => {
    const parsed = PrefetchRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest(parsed.error);
    const result = await ctx.prefetch.request(parsed.data, stripIpv6Prefix(request.ip));
    return reply.code(202).send(result);
  });
}
