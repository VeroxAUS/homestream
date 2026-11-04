import type { ServerInfo } from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { getLanAddresses } from '../net.js';
import { SERVER_VERSION } from '../version.js';

export function listeningPort(app: FastifyInstance, fallback: number): number {
  const address = app.server.address();
  return app.server.listening && address && typeof address === 'object' ? address.port : fallback;
}

export function registerInfoRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/info', async (): Promise<ServerInfo> => ({
    app: 'homestream',
    name: ctx.config.serverName,
    version: SERVER_VERSION,
    port: listeningPort(app, ctx.config.port),
    lanAddresses: getLanAddresses(),
  }));
}
