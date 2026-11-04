import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createSilentLogger } from '../src/logger.js';
import { clearSecrets } from '../src/redact.js';
import { SERVER_VERSION } from '../src/version.js';
import { makeTempDir, makeWebDir, removeDir, startTestApp, testConfig } from './helpers.js';

let root: string;
let app: FastifyInstance;

beforeAll(async () => {
  root = makeTempDir('app');
  app = await startTestApp(root, { HOMESTREAM_WEB_DIR: makeWebDir(root) });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  clearSecrets();
  removeDir(root);
});

const profile = (id: string, extra: Record<string, unknown> = {}) => ({
  deviceId: id,
  deviceName: `Name ${id}`,
  kind: 'tv',
  maxWidth: 3840,
  maxHeight: 2160,
  h264: true,
  hevc: true,
  hevcMain10: true,
  hdr10: true,
  maxAudioChannels: 6,
  ...extra,
});

describe('GET /api/info', () => {
  it('identifies the server', async () => {
    const res = await app.inject('/api/info');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ app: 'homestream', version: SERVER_VERSION });
    expect(body.name).toMatch(/\S/);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Array.isArray(body.lanAddresses)).toBe(true);
    for (const address of body.lanAddresses) expect(address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('reports the configured port when not yet listening', async () => {
    const res = await app.inject('/api/info');
    expect(res.json().port).toBe(0);
  });
});

describe('server with a missing required key', () => {
  it('still builds and serves /api/info', async () => {
    const dir = makeTempDir('missing');
    const missing = await buildApp(testConfig(dir, {}, ''), { logger: createSilentLogger() });
    try {
      expect(missing.ctx.config.missingKeys).toEqual(['GATEWAY_MANIFEST_URL', 'TMDB_READ_TOKEN']);
      const res = await missing.inject('/api/info');
      expect(res.statusCode).toBe(200);
    } finally {
      await missing.close();
      removeDir(dir);
    }
  });
});

describe('CORS', () => {
  it('allows any origin on simple requests', async () => {
    const res = await app.inject({ url: '/api/info', headers: { origin: 'http://example.test' } });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('answers preflight for POST with JSON content type', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/sessions',
      headers: {
        origin: 'http://example.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    const methods = String(res.headers['access-control-allow-methods']);
    for (const method of ['POST', 'PATCH', 'DELETE']) expect(methods).toContain(method);
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('content-type');
  });
});

describe('error shape', () => {
  it('returns JSON 404 for unknown /api routes', async () => {
    const res = await app.inject('/api/does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toMatchObject({ error: { code: 'not_found', message: expect.any(String) } });
  });

  it('never falls back to index.html for /api or /hls paths', async () => {
    for (const url of ['/api', '/api/x/y', '/hls/abc/index.m3u8', '/hls']) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    }
  });

  it('returns 400 invalid_request for a malformed JSON body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'bad_request', message: expect.any(String) });
    expect(res.body).not.toContain('at ');
  });

  it('returns a generic 500 body without stack traces', async () => {
    const local = await startTestApp(makeTempDirUnder(root, 'boom'));
    local.get('/api/boom', async () => {
      throw new Error('secret internals tmdb-test-token-123456');
    });
    const res = await local.inject('/api/boom');
    await local.close();
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('internal_error');
    expect(res.body).not.toContain('secret internals');
    expect(res.body).not.toContain('tmdb-test-token');
  });
});

function makeTempDirUnder(parent: string, name: string): string {
  const dir = path.join(parent, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('static web UI', () => {
  it.each(['/', '/dashboard/health', '/movie/278', '/index.html'])('serves index.html for %s', async (url) => {
    const res = await app.inject(url);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<div id="root">');
  });

  it('serves real assets and 404s missing ones as JSON', async () => {
    const asset = await app.inject('/assets/app.js');
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain('console.log');
    const missing = await app.inject('/assets/missing.js');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('not_found');
  });

  it('does not serve the SPA for non-GET methods', async () => {
    const res = await app.inject({ method: 'POST', url: '/dashboard/health' });
    expect(res.statusCode).toBe(404);
  });

  it('returns JSON 404 at / when no web build exists', async () => {
    const dir = makeTempDir('noweb');
    const bare = await startTestApp(dir);
    const res = await bare.inject('/');
    await bare.close();
    removeDir(dir);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});

describe('devices', () => {
  const ids = ['dev-a', 'dev-b'];

  it('upserts and lists devices with capabilities and lastSeen', async () => {
    for (const id of ids) {
      const res = await app.inject({ method: 'POST', url: '/api/devices', payload: profile(id) });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id, deviceId: id, name: `Name ${id}`, kind: 'tv' });
    }
    const list = (await app.inject('/api/devices')).json().devices as Record<string, unknown>[];
    for (const id of ids) {
      const matches = list.filter((d) => d.id === id);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ capabilities: profile(id) });
      expect(Number.isNaN(Date.parse(String(matches[0]?.lastSeen)))).toBe(false);
    }
  });

  it('re-posting renames without duplicating and refreshes lastSeen', async () => {
    const before = (await app.inject('/api/devices')).json().devices as { id: string; lastSeen: string }[];
    const firstSeen = before.find((d) => d.id === 'dev-a')?.lastSeen as string;
    await new Promise((resolve) => setTimeout(resolve, 15));
    const res = await app.inject({
      method: 'POST',
      url: '/api/devices',
      payload: profile('dev-a', { deviceName: 'Renamed' }),
    });
    expect(res.json().name).toBe('Renamed');
    const after = (await app.inject('/api/devices')).json().devices as { id: string; name: string; lastSeen: string }[];
    expect(after.filter((d) => d.id === 'dev-a')).toHaveLength(1);
    const updated = after.find((d) => d.id === 'dev-a');
    expect(updated?.name).toBe('Renamed');
    expect(Date.parse(updated?.lastSeen ?? '')).toBeGreaterThan(Date.parse(firstSeen));
  });

  it.each([
    ['missing deviceId', (() => { const { deviceId: _d, ...rest } = profile('x'); return rest; })()],
    ['unknown kind', profile('x', { kind: 'toaster' })],
    ['empty body object', {}],
  ])('rejects %s with the standard error shape', async (_name, payload) => {
    const res = await app.inject({ method: 'POST', url: '/api/devices', payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'invalid_request', message: expect.any(String), hint: expect.any(String) } });
  });

  it('rejects a request with no body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/devices' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toMatch(/invalid_request|bad_request/);
  });
});