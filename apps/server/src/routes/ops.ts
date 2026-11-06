import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import rateLimit from '@fastify/rate-limit';
import type { HealthzResponse, ReadyzResponse } from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { AppError } from '../errors.js';

async function dataDirWritable(dataDir: string): Promise<boolean> {
  const probe = path.join(dataDir, `.ready-${randomUUID()}`);
  try {
    await writeFile(probe, '');
    await rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function databaseUsable(ctx: AppContext): boolean {
  try {
    ctx.db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

/** A monitoring probe runs every few seconds; this is far above that and far below a loop that wears out the disk. */
export const READYZ_MAX_PER_MINUTE = 300;

/** Probes and metrics for monitoring. None of them calls TMDB, the gateway or TorBox. */
export async function registerOpsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Opt-in per route: playback, HLS and the UI must never be throttled. The plugin has to load before the route exists.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () =>
      new AppError(429, 'too_many_requests', 'Too many requests from this address.', 'Wait a minute and try again.'),
  });

  app.get('/healthz', async (): Promise<HealthzResponse> => ({ status: 'ok' }));

  const readyzLimit = { max: READYZ_MAX_PER_MINUTE, timeWindow: '1 minute' };
  app.get('/readyz', { config: { rateLimit: readyzLimit } }, async (): Promise<ReadyzResponse> => {
    if (!databaseUsable(ctx)) {
      throw new AppError(
        503,
        'not_ready',
        'The database is not usable.',
        'Restart the server and check the data directory.',
      );
    }
    if (!(await dataDirWritable(ctx.config.dataDir))) {
      throw new AppError(
        503,
        'not_ready',
        'The data directory is not writable.',
        'Check that the data directory exists, has free space and is writable by the server.',
      );
    }
    return { status: 'ready' };
  });

  app.get('/metrics', async (_request, reply) => {
    const body = await ctx.metrics.render();
    return reply.header('cache-control', 'no-store').type(ctx.metrics.contentType).send(body);
  });
}
