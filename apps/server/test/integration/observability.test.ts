import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/index.js';
import { createLogger, type AppLogger } from '../../src/logger.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir, startTestApp, testConfig } from '../helpers.js';
import { buildApp } from '../../src/app.js';
import { READYZ_MAX_PER_MINUTE } from '../../src/routes/ops.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let root: string;
let appLogger: AppLogger;
let app: FastifyInstance;
let logFile: string;

beforeAll(async () => {
  root = makeTempDir('observability');
  const logDir = path.join(root, 'logs');
  appLogger = createLogger({ dataDir: logDir, stdout: false });
  logFile = path.join(logDir, 'server.log');
  app = await startTestApp(root, {}, { logger: appLogger.logger });
  app.get('/__boom', () => {
    throw new Error('boom with C:\\Users\\Alice\\secret.txt');
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await appLogger.close();
  clearSecrets();
  removeDir(root);
});

async function logLines(): Promise<Array<Record<string, unknown>>> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function metricValue(text: string, name: string, labels: Record<string, string> = {}): number {
  const wanted = Object.entries(labels).map(([key, value]) => `${key}="${value}"`);
  for (const line of text.split('\n')) {
    if (!line.startsWith(`${name}{`) && !line.startsWith(`${name} `)) continue;
    if (wanted.every((part) => line.includes(part))) return Number(line.slice(line.lastIndexOf(' ') + 1));
  }
  return 0;
}

async function scrape(): Promise<string> {
  const res = await app.inject('/metrics');
  expect(res.statusCode).toBe(200);
  return res.body;
}

describe('X-Request-ID', () => {
  it('generates a UUID when the request has none and echoes it', async () => {
    const res = await app.inject('/api/info');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('echoes a supplied id made of plain characters', async () => {
    const res = await app.inject({ url: '/api/info', headers: { 'x-request-id': 'client.req_42-A' } });
    expect(res.headers['x-request-id']).toBe('client.req_42-A');
  });

  it.each([
    ['too long', 'a'.repeat(65)],
    ['spaces', 'two words'],
    ['markup', '<script>alert(1)</script>'],
    ['path characters', '../../etc/passwd'],
    ['unicode', 'ünïcode'],
  ])('replaces an unsafe supplied id (%s) with a fresh UUID', async (_label, supplied) => {
    const res = await app.inject({ url: '/api/info', headers: { 'x-request-id': supplied } });
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.headers['x-request-id']).not.toBe(supplied);
  });

  it('accepts exactly 64 characters', async () => {
    const id = 'a'.repeat(64);
    const res = await app.inject({ url: '/api/info', headers: { 'x-request-id': id } });
    expect(res.headers['x-request-id']).toBe(id);
  });

  it('is present on errors and keeps the error body shape', async () => {
    const missing = await app.inject({ url: '/api/nope', headers: { 'x-request-id': 'req-404' } });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['x-request-id']).toBe('req-404');
    expect(Object.keys(missing.json())).toEqual(['error']);
    expect(Object.keys(missing.json().error).sort()).toEqual(['code', 'hint', 'message']);

    const boom = await app.inject({ url: '/__boom', headers: { 'x-request-id': 'req-500' } });
    expect(boom.statusCode).toBe(500);
    expect(boom.headers['x-request-id']).toBe('req-500');
    expect(boom.json()).toEqual({
      error: {
        code: 'internal_error',
        message: 'Something went wrong on the server.',
        hint: 'Check the server log for details.',
      },
    });
  });

  it('is exposed to browsers and sentry-trace and baggage may be sent', async () => {
    const simple = await app.inject({ url: '/api/info', headers: { origin: 'http://tv.example.test' } });
    expect(simple.headers['access-control-expose-headers']).toMatch(/X-Request-ID/i);
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/sessions',
      headers: {
        origin: 'http://tv.example.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-request-id,sentry-trace,baggage',
      },
    });
    expect(preflight.statusCode).toBe(204);
    const allowed = String(preflight.headers['access-control-allow-headers']).toLowerCase();
    for (const header of ['content-type', 'x-request-id', 'sentry-trace', 'baggage']) expect(allowed).toContain(header);
  });
});

describe('request log line', () => {
  it('carries reqId, method, route template, status and timing, and never the query or credentials', async () => {
    const res = await app.inject({
      url: '/api/info?token=PLACEHOLDER',
      headers: { 'x-request-id': 'req-log-1', authorization: 'Bearer header-token-0123456789abcdef' },
    });
    expect(res.statusCode).toBe(200);
    const lines = await logLines();
    const line = lines.find((entry) => entry.reqId === 'req-log-1' && entry.msg === 'request completed');
    expect(line).toMatchObject({ reqId: 'req-log-1', method: 'GET', route: '/api/info', statusCode: 200 });
    expect(typeof line?.responseTimeMs).toBe('number');
    const raw = readFileSync(logFile, 'utf8');
    expect(raw).not.toContain('token=PLACEHOLDER');
    expect(raw).not.toContain('header-token-0123456789abcdef');
  });

  it('logs a route template, not the ids in the path', async () => {
    await app.inject({
      url: '/api/sessions/1b4e28ba-2fa1-11d2-883f-0016d3cca427',
      headers: { 'x-request-id': 'req-log-2' },
    });
    const line = (await logLines()).find((entry) => entry.reqId === 'req-log-2' && entry.msg === 'request completed');
    expect(line?.route).toBe('/api/sessions/:id');
    expect(JSON.stringify(line)).not.toContain('1b4e28ba');
  });

  it('binds the same reqId to the error line of a failed request', async () => {
    await app.inject({ url: '/__boom', headers: { 'x-request-id': 'req-log-3' } });
    const lines = (await logLines()).filter((entry) => entry.reqId === 'req-log-3');
    expect(lines.map((entry) => entry.msg)).toEqual(expect.arrayContaining(['Unhandled error', 'request completed']));
    expect(lines.find((entry) => entry.msg === 'request completed')?.statusCode).toBe(500);
  });

  it('does not log health probes, or metrics scrapes at info level', async () => {
    await app.inject({ url: '/metrics', headers: { 'x-request-id': 'req-quiet-1' } });
    await app.inject({ url: '/healthz', headers: { 'x-request-id': 'req-quiet-2' } });
    await app.inject({ url: '/readyz', headers: { 'x-request-id': 'req-quiet-3' } });
    const lines = await logLines();
    expect(lines.filter((entry) => String(entry.reqId).startsWith('req-quiet'))).toEqual([]);
  });
});

describe('GET /metrics', () => {
  it('is Prometheus text with the required families', async () => {
    const res = await app.inject('/metrics');
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    for (const family of [
      'process_cpu_seconds_total',
      'nodejs_eventloop_lag_seconds',
      'homestream_http_requests_total',
      'homestream_http_request_duration_seconds_bucket',
      'homestream_sessions_active',
      'homestream_sessions_started_total',
      'homestream_sessions_failed_total',
      'homestream_encoder_speed_avg',
      'homestream_encoder_restarts_total',
      'homestream_gateway_requests_total',
      'homestream_gateway_cache_hits_total',
      'homestream_tmdb_requests_total',
      'homestream_tmdb_cache_hits_total',
      'homestream_sourceproxy_cache_hits_total',
      'homestream_sourceproxy_cache_misses_total',
    ]) {
      expect(res.body, family).toContain(`# TYPE ${family.replace(/_bucket$/, '')} `);
    }
  });

  it('counts requests by route template and does not count itself, probes or unknown paths by their raw url', async () => {
    const labels = { method: 'GET', route: '/api/info', status: '200' };
    const before = metricValue(await scrape(), 'homestream_http_requests_total', labels);
    for (let i = 0; i < 3; i += 1) await app.inject('/api/info');
    await app.inject('/healthz');
    await app.inject('/api/sessions/1b4e28ba-2fa1-11d2-883f-0016d3cca427/anything/9f8e7d6c5b4a');
    const text = await scrape();
    expect(metricValue(text, 'homestream_http_requests_total', labels) - before).toBe(3);
    expect(text).not.toContain('route="/metrics"');
    expect(text).not.toContain('route="/healthz"');
    expect(text).not.toMatch(/1b4e28ba|9f8e7d6c/);
    const durationCount = metricValue(text, 'homestream_http_request_duration_seconds_count', labels);
    expect(durationCount - before).toBe(3);
  });

  it('keeps ids, hosts and secrets out of every label value', async () => {
    await app.inject('/api/home');
    const text = await scrape();
    const values = [...text.matchAll(/="([^"]*)"/g)].map((match) => match[1] as string);
    for (const value of values) {
      expect(value).not.toMatch(/https?:|example\.test|tmdb-test-token|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    }
  });
});

describe('GET /healthz and /readyz', () => {
  it('answer without calling any upstream service', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
      calls += 1;
      return Promise.reject(new Error('no network in probes'));
    }) as typeof fetch;
    try {
      const health = await app.inject('/healthz');
      const ready = await app.inject('/readyz');
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: 'ok' });
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toEqual({ status: 'ready' });
      expect(health.headers['x-request-id']).toMatch(UUID);
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toBe(0);
  });

  it('is documented in OpenAPI', async () => {
    const spec = (await app.inject('/api/docs/json')).json() as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/healthz', '/readyz', '/metrics']));
  });
});

describe('GET /readyz rate limit', () => {
  it('answers 429 in the usual error shape after the per-address limit, and only on /readyz', async () => {
    const dir = makeTempDir('readyz-limit');
    const limited = await startTestApp(dir);
    try {
      await limited.ready();
      for (let i = 0; i < READYZ_MAX_PER_MINUTE; i += 1) {
        expect((await limited.inject('/readyz')).statusCode).toBe(200);
      }
      const res = await limited.inject('/readyz');
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toEqual(expect.any(String));
      expect(res.json()).toMatchObject({
        error: { code: 'too_many_requests', message: expect.any(String), hint: expect.any(String) },
      });
      expect((await limited.inject('/healthz')).statusCode).toBe(200);
      expect((await limited.inject('/metrics')).statusCode).toBe(200);
      expect((await limited.inject('/api/info')).statusCode).toBe(200);
    } finally {
      await limited.close();
      removeDir(dir);
    }
  });

  it('counts each client address separately', async () => {
    const dir = makeTempDir('readyz-limit-ip');
    const limited = await startTestApp(dir);
    try {
      await limited.ready();
      for (let i = 0; i <= READYZ_MAX_PER_MINUTE; i += 1)
        await limited.inject({ url: '/readyz', remoteAddress: '198.51.100.7' });
      expect((await limited.inject({ url: '/readyz', remoteAddress: '198.51.100.7' })).statusCode).toBe(429);
      expect((await limited.inject({ url: '/readyz', remoteAddress: '198.51.100.8' })).statusCode).toBe(200);
    } finally {
      await limited.close();
      removeDir(dir);
    }
  });
});

describe('GET /readyz when something is unusable', () => {
  it('answers 503 in the usual error shape when the data directory is missing', async () => {
    const dir = makeTempDir('readyz-dir');
    const broken = await startTestApp(dir);
    try {
      await broken.ready();
      Object.assign(broken.ctx.config, { dataDir: path.join(dir, 'gone', 'deeper') });
      const res = await broken.inject('/readyz');
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({
        error: { code: 'not_ready', message: expect.any(String), hint: expect.any(String) },
      });
    } finally {
      await broken.close();
      removeDir(dir);
    }
  });

  it('answers 503 when the database is closed', async () => {
    const dir = makeTempDir('readyz-db');
    const config = testConfig(dir);
    const db = openDatabase(config.dataDir);
    const broken = await buildApp(config, { db, logger: appLogger.logger });
    try {
      await broken.ready();
      db.close();
      const res = await broken.inject('/readyz');
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('not_ready');
      expect((await broken.inject('/healthz')).statusCode).toBe(200);
    } finally {
      await broken.close().catch(() => undefined);
      removeDir(dir);
    }
  });
});
