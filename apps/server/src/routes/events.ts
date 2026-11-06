import type { FastifyInstance } from 'fastify';
import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import type { AppContext } from '../context.js';

export interface EventRouteOptions {
  heartbeatMs?: number;
}

export const HEARTBEAT_MS = 15_000;

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function registerEventRoutes(app: FastifyInstance, ctx: AppContext, options: EventRouteOptions = {}): void {
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const open = new Set<ServerResponse>();

  app.get('/api/events', (request, reply) => {
    // Hijacked replies skip onSend, so the CORS headers set in onRequest are copied manually.
    const headers: OutgoingHttpHeaders = {
      ...(reply.getHeaders() as OutgoingHttpHeaders),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    };
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, headers);
    open.add(raw);

    raw.write(`retry: 3000\n${frame('heartbeat', { ts: Date.now() })}`);

    const unsubscribe = ctx.bus.subscribe((event) => {
      raw.write(frame(event.type, event.data));
    });
    const timer = setInterval(() => {
      raw.write(frame('heartbeat', { ts: Date.now() }));
    }, heartbeatMs);

    ctx.downloads.clientConnected();
    ctx.downloads.replayUnnotified();

    let closed = false;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      unsubscribe();
      open.delete(raw);
      ctx.downloads.clientDisconnected();
    };
    request.raw.on('close', cleanup);
    raw.on('error', cleanup);
  });

  app.addHook('onClose', async () => {
    for (const raw of open) raw.end();
    open.clear();
  });
}
