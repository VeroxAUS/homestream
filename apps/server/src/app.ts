import cors from '@fastify/cors';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import { registerConfigSecrets, type Config } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase, type Db } from './db/index.js';
import { registerOpenApi } from './docs/openapi.js';
import { DownloadService, type DownloadServiceOptions } from './downloads/service.js';
import { AllStreamsFailedError, AppError, codeForStatus, errorBody } from './errors.js';
import { EventBus } from './events/bus.js';
import { logEvent } from './events/record.js';
import { ServerMetrics } from './metrics/serverMetrics.js';
import { GatewayClient } from './gateway/client.js';
import type { HealthFetch } from './health/checks/gateway.js';
import type { CommandRunner, DiskProbe } from './health/exec.js';
import { HealthService } from './health/service.js';
import { HomeService } from './home/service.js';
import { allowEmptyJsonBody } from './http/emptyJsonBody.js';
import { CORS_ALLOWED_HEADERS, registerRequestObservability } from './http/observability.js';
import { createLogger } from './logger.js';
import { generateRequestId } from './requestContext.js';
import { PlaybackManager, type PlaybackManagerOptions } from './playback/manager.js';
import { createFfprobeRunner, type ProbeRunner } from './playback/probe.js';
import { createUrlResolver, type UrlResolver } from './playback/resolveUrl.js';
import { PrefetchService, type PrefetchServiceOptions } from './prefetch/service.js';
import { ContinueWatchingService } from './progress/service.js';
import { SourceProxy, type SourceProxyOptions } from './sourceproxy/proxy.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerDownloadRoutes } from './routes/downloads.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerEventRoutes } from './routes/events.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerHistoryRoutes } from './routes/history.js';
import { registerInfoRoutes } from './routes/info.js';
import { registerOpsRoutes } from './routes/ops.js';
import { registerPrefetchRoutes } from './routes/prefetch.js';
import { registerProgressRoutes } from './routes/progress.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerStatic, shouldServeSpaFallback } from './routes/static.js';
import { registerStreamRoutes } from './routes/streams.js';
import { StreamService } from './streams/service.js';
import { createPlaybackObserver } from './telemetry/playbackObserver.js';
import { createTelemetry, type Telemetry } from './telemetry/index.js';
import { TmdbService } from './tmdb/service.js';
import { SERVER_VERSION } from './version.js';

export interface BuildAppOptions {
  logger?: FastifyBaseLogger;
  db?: Db;
  bus?: EventBus;
  tmdb?: TmdbService;
  gateway?: GatewayClient;
  /** Test seams for the playback pipeline (ffprobe, CDN link resolution, segment wait). */
  playback?: Pick<
    PlaybackManagerOptions,
    | 'segmentWaitMs'
    | 'firstSegmentWaitMs'
    | 'subtitleHoldMs'
    | 'maxSessions'
    | 'createEncoder'
    | 'idleTimeoutMs'
    | 'monitorTickMs'
  > & {
    probe?: ProbeRunner;
    resolveUrl?: UrlResolver;
  };
  /** Test seams for the source proxy's lifetime and cache limits. */
  sourceProxy?: Pick<
    SourceProxyOptions,
    | 'prefetchTtlMs'
    | 'maxPrefetchEntries'
    | 'sweepIntervalMs'
    | 'globalCapBytes'
    | 'perSourceCapBytes'
    | 'maxDownloadMbps'
    | 'readAheadSec'
    | 'readAheadResumeSec'
  >;
  prefetch?: Pick<PrefetchServiceOptions, 'streamIdBudgetMs'>;
  /** Test seams for the TorBox poller: HTTP calls, clock and time limits. */
  downloads?: Pick<DownloadServiceOptions, 'torboxFetch' | 'now' | 'limits'>;
  /** Test seams for the health checks: network, child processes, disk space and timing. */
  health?: {
    fetch?: HealthFetch;
    run?: CommandRunner;
    diskProbe?: DiskProbe;
    now?: () => number;
    intervalMs?: number;
    liveIntervalMs?: number;
  };
  heartbeatMs?: number;
  /** Replaces the telemetry built from `config.telemetry`; tests and the smoke command use it. */
  telemetry?: Telemetry;
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
  const telemetry =
    options.telemetry ??
    createTelemetry({
      config: config.telemetry,
      db,
      logger: {
        info: (message) => logger.info(message),
        warn: (message) => logger.warn(message),
        debug: (fields, message) => logger.debug(fields, message),
      },
      version: SERVER_VERSION,
    });
  const metrics = new ServerMetrics();
  const tmdb = options.tmdb ?? new TmdbService({ config, db, logger });
  const gateway = options.gateway ?? new GatewayClient({ config, db, logger });
  const streams = new StreamService(gateway, db);
  const { probe, resolveUrl, ...playbackOptions } = options.playback ?? {};
  const sourceProxy = new SourceProxy({
    resolveUrl: resolveUrl ?? createUrlResolver(),
    probe: probe ?? createFfprobeRunner(config.ffprobePath),
    port: config.sourceProxyPort,
    logger,
    maxDownloadMbps: config.maxDownloadMbps,
    readAheadSec: config.readAheadSec,
    readAheadResumeSec: config.readAheadResumeSec,
    onEvent: (event) => logEvent({ db, bus }, { ...event, source: 'session' }),
    ...options.sourceProxy,
  });
  const downloads = new DownloadService({ config, db, bus, logger, gateway, streams, ...options.downloads });
  const playback = new PlaybackManager({
    config,
    db,
    bus,
    logger,
    tmdb,
    streams,
    downloads,
    proxy: sourceProxy,
    observer: createPlaybackObserver(metrics, telemetry),
    ...playbackOptions,
  });
  const prefetch = new PrefetchService({
    tmdb,
    streams,
    proxy: sourceProxy,
    db,
    bus,
    logger,
    telemetry,
    ...options.prefetch,
  });
  metrics.attach({
    activeSessions: () => playback.activity().length,
    encoderSpeeds: () => playback.activity().map((session) => session.encoder.speed),
    gateway: () => ({
      requests: gateway.stats.requests,
      errors: gateway.stats.errors,
      cacheHits: gateway.cacheStats.hits,
      cacheMisses: gateway.cacheStats.misses,
    }),
    tmdb: () => tmdb.stats,
    proxyCache: () => sourceProxy.stats().cache,
  });
  const continueWatching = new ContinueWatchingService({ db, tmdb, logger });
  const home = new HomeService({ db, tmdb, continueWatching, logger });
  const health = new HealthService({
    config,
    db,
    bus,
    logger,
    gateway,
    tmdb,
    playback,
    sourceProxy,
    ...options.health,
  });
  const ctx: AppContext = {
    config,
    db,
    bus,
    logger,
    tmdb,
    gateway,
    streams,
    playback,
    downloads,
    sourceProxy,
    prefetch,
    continueWatching,
    home,
    health,
    telemetry,
    metrics,
  };

  // The header is sanitized in genReqId (Fastify would otherwise take any client value as is).
  const app = Fastify({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    genReqId: generateRequestId,
  });
  app.decorate('ctx', ctx);
  allowEmptyJsonBody(app);
  registerRequestObservability(app, ctx);

  await app.register(cors, {
    origin: '*',
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: CORS_ALLOWED_HEADERS,
    exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'X-Request-ID'],
    maxAge: 600,
  });

  await registerOpenApi(app);

  const hasWeb = await registerStatic(app, config.webDir);

  app.setNotFoundHandler((request, reply) => {
    if (hasWeb && shouldServeSpaFallback(request.url, request.method)) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }
    return reply
      .code(404)
      .send(
        errorBody(
          'not_found',
          `No route for ${request.method} ${request.url.split('?')[0]}.`,
          'Check the URL and HTTP method.',
        ),
      );
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      if (error.headers) reply.headers(error.headers);
      const attempts = error instanceof AllStreamsFailedError ? error.attempts : undefined;
      return reply.code(error.statusCode).send(errorBody(error.code, error.message, error.hint, attempts));
    }
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'Unhandled error');
      telemetry.captureError(error, { requestId: request.id });
      return reply
        .code(500)
        .send(errorBody('internal_error', 'Something went wrong on the server.', 'Check the server log for details.'));
    }
    return reply.code(status).send(errorBody(codeForStatus(status), error.message, 'Check the request and try again.'));
  });

  registerInfoRoutes(app, ctx);
  registerDeviceRoutes(app, ctx);
  registerCatalogRoutes(app, ctx);
  registerStreamRoutes(app, ctx);
  registerSessionRoutes(app, ctx);
  registerDownloadRoutes(app, ctx);
  registerProgressRoutes(app, ctx);
  registerHistoryRoutes(app, ctx);
  registerPrefetchRoutes(app, ctx);
  registerHealthRoutes(app, ctx);
  await registerOpsRoutes(app, ctx);
  registerEventRoutes(app, ctx, { heartbeatMs: options.heartbeatMs });

  app.addHook('onClose', async () => {
    health.stop();
    downloads.close();
    await playback.close();
    await sourceProxy.close();
    if (!options.telemetry) await telemetry.shutdown();
    if (!options.gateway) gateway.close();
    if (!options.db) db.close();
    await ownedLogger?.close();
  });

  return app;
}
