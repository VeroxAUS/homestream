import cors from '@fastify/cors';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import { registerConfigSecrets, type Config } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase, type Db } from './db/index.js';
import { AppError, codeForStatus, errorBody } from './errors.js';
import { EventBus } from './events/bus.js';
import { GatewayClient } from './gateway/client.js';
import { createLogger } from './logger.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerEventRoutes } from './routes/events.js';
import { registerInfoRoutes } from './routes/info.js';
import { registerStatic, shouldServeSpaFallback } from './routes/static.js';
import { registerStreamRoutes } from './routes/streams.js';
import { StreamService } from './streams/service.js';
import { TmdbService } from './tmdb/service.js';

export interface BuildAppOptions {
  logger?: FastifyBaseLogger;
  db?: Db;
  bus?: EventBus;
  tmdb?: TmdbService;
  gateway?: GatewayClient;
  heartbeatMs?: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export async function buildApp(config: Config, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  registerConfigSecrets(config);

  const ownedLogger = options.logger ? null : createLogger({ dataDir: config.dataDir });
  const logger: FastifyBaseLogger = options.logger ?? (ownedLogger as NonNullable<typeof ownedLogger>).logger;
  const db = options.db ?? openDatabase(config.dataDir);
  const bus = options.bus ?? new EventBus();
  const tmdb = options.tmdb ?? new TmdbService({ config, db, logger });
  const gateway = options.gateway ?? new GatewayClient({ config, db, logger });
  const streams = new StreamService(gateway, db);
  const ctx: AppContext = { config, db, bus, logger, tmdb, gateway, streams };

  const app = Fastify({ loggerInstance: logger, logController: new LogController({ disableRequestLogging: true }) });
  app.decorate('ctx', ctx);

  await app.register(cors, {
    origin: '*',
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
    maxAge: 600,
  });

  const hasWeb = await registerStatic(app, config.webDir);

  app.setNotFoundHandler((request, reply) => {
    if (hasWeb && shouldServeSpaFallback(request.url, request.method)) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }
    return reply
      .code(404)
      .send(errorBody('not_found', `No route for ${request.method} ${request.url.split('?')[0]}.`, 'Check the URL and HTTP method.'));
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message, error.hint));
    }
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'Unhandled error');
      return reply
        .code(500)
        .send(errorBody('internal_error', 'Something went wrong on the server.', 'Check the server log for details.'));
    }
    return reply
      .code(status)
      .send(errorBody(codeForStatus(status), error.message, 'Check the request and try again.'));
  });

  registerInfoRoutes(app, ctx);
  registerDeviceRoutes(app, ctx);
  registerCatalogRoutes(app, ctx);
  registerStreamRoutes(app, ctx);
  registerEventRoutes(app, ctx, { heartbeatMs: options.heartbeatMs });

  app.addHook('onClose', async () => {
    if (!options.gateway) gateway.close();
    if (!options.db) db.close();
    await ownedLogger?.close();
  });

  return app;
}
