import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir, startTestApp } from '../helpers.js';

let root: string;
let app: FastifyInstance;

beforeAll(async () => {
  root = makeTempDir('empty-json');
  app = await startTestApp(root);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  clearSecrets();
  removeDir(root);
});

const json = { 'content-type': 'application/json' };

describe('application/json with an empty body', () => {
  it('is accepted on body-less routes: DELETE reaches the handler (404 for an unknown session, not 400)', async () => {
    for (const payload of [undefined, '', '   ']) {
      const res = await app.inject({ method: 'DELETE', url: '/api/sessions/nonexistent', headers: json, payload });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).not.toBe('invalid_request');
    }
  });

  it('still reaches route-level validation on routes that need a body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sessions', headers: json, payload: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'invalid_request' });
  });

  it('keeps rejecting malformed JSON with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sessions', headers: json, payload: '{"a":' });
    expect(res.statusCode).toBe(400);
  });

  it('still parses a normal JSON body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sessions', headers: json, payload: { mediaType: 'music' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_request');
  });
});
