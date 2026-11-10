import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { createLogger, type AppLogger } from '../../src/logger.js';
import { clearSecrets, registerSecret } from '../../src/redact.js';
import { makeTempDir, removeDir, startTestApp } from '../helpers.js';

describe('EventBus', () => {
  it('delivers typed events to subscribers and supports unsubscribe', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const off = bus.subscribe((event) => seen.push(event.type));
    bus.emit('health', { overall: 'ok' });
    off();
    bus.emit('log', { message: 'x' });
    expect(seen).toEqual(['health']);
    expect(bus.listenerCount).toBe(0);
  });

  it('isolates a throwing subscriber', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error('bad listener');
    });
    bus.subscribe((event) => seen.push(event.type));
    expect(() => bus.emit('session.start', { sessionId: 's' })).not.toThrow();
    expect(seen).toEqual(['session.start']);
  });

  it('redacts payloads', () => {
    registerSecret('topsecretvalue');
    const bus = new EventBus();
    let payload = '';
    bus.subscribe((event) => (payload = JSON.stringify(event.data)));
    bus.emit('log', { message: 'leak topsecretvalue here' });
    clearSecrets();
    expect(payload).not.toContain('topsecretvalue');
  });
});

describe('GET /api/events', () => {
  let root: string;
  let app: FastifyInstance;
  let base: string;

  beforeAll(async () => {
    root = makeTempDir('sse');
    app = await startTestApp(root, {}, { heartbeatMs: 100 });
    base = await app.listen({ port: 0, host: '127.0.0.1' });
  });
  afterAll(async () => {
    await app.close();
    removeDir(root);
  });

  async function readUntil(response: Response, done: (text: string) => boolean, timeoutMs = 3000): Promise<string> {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !done(text)) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now())),
      ]);
      if (!chunk || chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    await reader.cancel();
    return text;
  }

  it('streams SSE with CORS headers, heartbeats and bus events', async () => {
    const response = await fetch(`${base}/api/events`, { headers: { origin: 'http://example.test' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');

    setTimeout(() => app.ctx.bus.emit('session.update', { sessionId: 's1', state: 'playing' }), 50);
    const text = await readUntil(
      response,
      (t) => (t.match(/event: heartbeat/g)?.length ?? 0) >= 3 && t.includes('session.update'),
    );

    expect(text.match(/event: heartbeat/g)?.length).toBeGreaterThanOrEqual(3);
    expect(text).toContain('event: session.update');
    expect(text).toContain('data: {"sessionId":"s1","state":"playing"}');
  });

  it('serves several clients and cleans up when they disconnect', async () => {
    const a = await fetch(`${base}/api/events`);
    const b = await fetch(`${base}/api/events`);
    setTimeout(() => app.ctx.bus.emit('log', { message: 'hello' }), 50);
    const [ta, tb] = await Promise.all([
      readUntil(a, (t) => t.includes('event: log')),
      readUntil(b, (t) => t.includes('event: log')),
    ]);
    expect(ta).toContain('event: log');
    expect(tb).toContain('event: log');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(app.ctx.bus.listenerCount).toBe(0);
  });
});

describe('GET /api/events request log line', () => {
  let root: string;
  let appLogger: AppLogger;
  let app: FastifyInstance;
  let base: string;
  let logFile: string;

  beforeAll(async () => {
    root = makeTempDir('sse-log');
    const logDir = path.join(root, 'logs');
    appLogger = createLogger({ dataDir: logDir, stdout: false });
    logFile = path.join(logDir, 'server.log');
    app = await startTestApp(root, {}, { heartbeatMs: 30, logger: appLogger.logger });
    base = await app.listen({ port: 0, host: '127.0.0.1' });
  });
  afterAll(async () => {
    await app.close();
    await appLogger.close();
    removeDir(root);
  });

  function logLines(): Array<Record<string, unknown>> {
    return readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it('logs the stream with its X-Request-ID while it is open, before any shutdown', async () => {
    const response = await fetch(`${base}/api/events`, { headers: { 'x-request-id': 'req-sse-open' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('req-sse-open');
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const lines = logLines().filter((entry) => entry.reqId === 'req-sse-open');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ method: 'GET', route: '/api/events', statusCode: 200 });
    await reader.cancel();
  });

  it('writes one line per stream, not one per heartbeat or event', async () => {
    const response = await fetch(`${base}/api/events`, { headers: { 'x-request-id': 'req-sse-quiet' } });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    setTimeout(() => app.ctx.bus.emit('log', { message: 'hello' }), 20);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(logLines().filter((entry) => entry.reqId === 'req-sse-quiet')).toHaveLength(1);
  });
});
