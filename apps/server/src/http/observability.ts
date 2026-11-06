import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { isInstrumentedPath } from '../metrics/serverMetrics.js';
import { REQUEST_ID_HEADER, runWithRequestId } from '../requestContext.js';

/** Includes the Sentry trace-propagation headers so browser SDKs can continue a trace into the server. */
export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Accept',
  'Range',
  'If-None-Match',
  'If-Range',
  'Cache-Control',
  'Authorization',
  'X-Request-ID',
  'sentry-trace',
  'baggage',
];

const UNMATCHED_ROUTE = 'unmatched';

/**
 * Request id on every response, one structured log line per request and the HTTP metrics.
 * Segment serving, the event stream and the monitoring endpoints are not counted or logged at info level: they are the
 * high-volume or self-referential traffic.
 */
export function registerRequestObservability(app: FastifyInstance, ctx: AppContext): void {
  app.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    runWithRequestId(request.id, done);
  });

  app.addHook('onResponse', (request, reply, done) => {
    const pathname = request.url.split('?', 1)[0] ?? '';
    const route = request.routeOptions.url ?? UNMATCHED_ROUTE;
    const responseTimeMs = Math.round(reply.elapsedTime * 10) / 10;
    const instrumented = isInstrumentedPath(pathname);
    if (instrumented) ctx.metrics.observeRequest(request.method, route, reply.statusCode, responseTimeMs / 1000);
    const fields = { method: request.method, route, statusCode: reply.statusCode, responseTimeMs };
    if (instrumented) request.log.info(fields, 'request completed');
    else request.log.debug(fields, 'request completed');
    done();
  });
}
