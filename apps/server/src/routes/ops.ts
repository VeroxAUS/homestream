import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

/** Probes and metrics for monitoring. None of them calls TMDB, the gateway or TorBox. */
export function registerOpsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/healthz', async (): Promise<HealthzResponse> => ({ status: 'ok' }));

  app.get('/readyz', async (): Promise<ReadyzResponse> => {
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
