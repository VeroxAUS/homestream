import diagnostics from 'node:diagnostics_channel';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPENAPI_FILE, renderOpenApi } from '../../src/docs/generated.js';
import { ROUTE_DOCS } from '../../src/docs/routeDocs.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, makeWebDir, removeDir, startTestApp } from '../helpers.js';

interface Operation {
  summary?: string;
  responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
}
type Paths = Record<string, Record<string, Operation>>;

let root: string;
let app: FastifyInstance;
/** `GET /api/home` style keys of the API routes Fastify registered, read through its own onRoute hook. */
const registered = new Set<string>();

function collectRoutes({ fastify }: { fastify: FastifyInstance }): void {
  fastify.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const isApi = route.url.startsWith('/api') || route.url.startsWith('/hls');
    if (!isApi || route.url.startsWith('/api/docs')) return;
    for (const method of methods)
      if (method !== 'HEAD' && method !== 'OPTIONS') registered.add(`${method} ${route.url}`);
  });
}

beforeAll(async () => {
  root = makeTempDir('openapi');
  diagnostics.subscribe('fastify.initialization', collectRoutes as diagnostics.ChannelListener);
  try {
    app = await startTestApp(root, { HOMESTREAM_WEB_DIR: makeWebDir(root) });
    await app.ready();
  } finally {
    diagnostics.unsubscribe('fastify.initialization', collectRoutes as diagnostics.ChannelListener);
  }
});
afterAll(async () => {
  await app.close();
  clearSecrets();
  removeDir(root);
});

const asOpenApiPath = (url: string): string => url.replace(/:(\w+)/g, '{$1}');
async function document(): Promise<{ openapi: string; info: { title: string }; paths: Paths }> {
  const res = await app.inject('/api/docs/json');
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('/api/docs', () => {
  it('serves Swagger UI as HTML and is not shadowed by the SPA fallback', async () => {
    const res = await app.inject({ url: '/api/docs/', headers: { accept: 'text/html' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toMatch(/swagger/i);
    expect(res.body).not.toContain('<div id="root">');
  });

  it('answers the bare /api/docs path with the UI, not the SPA', async () => {
    const res = await app.inject({ url: '/api/docs', headers: { accept: 'text/html' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).not.toContain('<div id="root">');
  });

  it('still serves the SPA for client-side routes', async () => {
    const res = await app.inject('/some/client/route');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<div id="root">');
  });
});

describe('/api/docs/json', () => {
  it('is an OpenAPI 3 document', async () => {
    const spec = await document();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe('HomeStream API');
    expect(Object.keys(spec.paths).length).toBeGreaterThan(20);
  });

  it('documents every registered API route with a summary and the shared error shape', async () => {
    const { paths } = await document();
    expect(registered.size).toBeGreaterThan(20);
    for (const route of registered) {
      const [method = '', url = ''] = route.split(' ');
      const operation = paths[asOpenApiPath(url)]?.[method.toLowerCase()];
      expect(operation, `${route} is missing from the OpenAPI document`).toBeDefined();
      expect(operation?.summary, `${route} has no summary`).toBeTruthy();
      expect(operation?.summary, `${route} has no entry in ROUTE_DOCS`).not.toMatch(/^Undocumented/);
      const responses = Object.keys(operation?.responses ?? {});
      expect(
        responses.some((status) => status.startsWith('2')),
        `${route} documents no success response`,
      ).toBe(true);
    }
  });

  it('has no documentation for routes that no longer exist', () => {
    for (const key of Object.keys(ROUTE_DOCS)) {
      expect(registered.has(key), `${key} is documented but not registered`).toBe(true);
    }
  });

  it('references the ErrorResponse component for every error status', async () => {
    const spec = (await document()) as unknown as { paths: Paths; components: { schemas: Record<string, unknown> } };
    expect(spec.components.schemas.ErrorResponse).toMatchObject({ required: ['error'] });
    const badRequest = spec.paths['/api/devices']?.post?.responses?.['400'];
    expect(badRequest?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/ErrorResponse');
  });

  it('does not list the docs routes or static files', async () => {
    const { paths } = await document();
    expect(Object.keys(paths).filter((url) => url.startsWith('/api/docs'))).toEqual([]);
    expect(paths['/*']).toBeUndefined();
  });
});

describe('docs/openapi.json', () => {
  it('matches the document the server generates, so the drift check passes', async () => {
    const committed = readFileSync(OPENAPI_FILE, 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(await renderOpenApi());
  });
});

describe('runtime behaviour is unchanged by the documentation', () => {
  it('keeps the plain error shape and 400 status for an invalid body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/devices', payload: { deviceId: '' } });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(Object.keys(body)).toEqual(['error']);
    expect(body.error).toMatchObject({ code: 'invalid_request' });
    expect(body.error.message).toMatch(/deviceId/);
    expect(body.error.hint).toBeTruthy();
  });

  it('keeps the 404 error shape for an unknown API path', async () => {
    const res = await app.inject('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('returns responses unfiltered by the documented schemas', async () => {
    const res = await app.inject('/api/info');
    expect(Object.keys(res.json()).sort()).toEqual(['app', 'lanAddresses', 'name', 'port', 'version']);
  });
});
