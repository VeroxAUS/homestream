import type { FastifyBaseLogger } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Db } from '../../src/db/index.js';
import { GatewayClient, type GatewayFetch } from '../../src/gateway/client.js';
import { RateLimiter } from '../../src/gateway/rateLimiter.js';
import { clearSecrets, registerSecret } from '../../src/redact.js';
import { makeTempDir, removeDir, testConfig } from '../helpers.js';

const RAW = 'https://gw.example.test/api/v1/debrid/playback/tok-secret-1/Movie.1994.1080p.mkv';
const MB = 1024 * 1024;
const LISTED = 2_000_000_000;

let db: Db;
let dir: string;
const clients: GatewayClient[] = [];

beforeEach(() => {
  db = openDatabase(':memory:');
  dir = makeTempDir('probe-playback');
  registerSecret('tok-secret-1');
});

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  db.close();
  removeDir(dir);
  clearSecrets();
});

const redirect = (location: string, status = 307): Response => new Response(null, { status, headers: { location } });

interface Rig {
  client: GatewayClient;
  urls: string[];
  debug: ReturnType<typeof vi.fn>;
}

/** `answers` are consumed one per request, in order; a request beyond them fails the test. */
function rig(answers: Array<Response | Error>): Rig {
  const urls: string[] = [];
  const debug = vi.fn();
  const fetch: GatewayFetch = async (url) => {
    urls.push(url);
    const next = answers.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    return next;
  };
  const logger = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
  const client = new GatewayClient({
    config: testConfig(dir),
    db,
    logger,
    fetch,
    limiter: new RateLimiter({ maxRequests: 50, windowMs: 100, marginMs: 5 }),
    playbackTimeoutMs: 2_000,
  });
  clients.push(client);
  return { client, urls, debug };
}

describe('probePlayback placeholder detection (VAL-DL-001)', () => {
  it.each([
    ['same-host absolute redirect', 'https://gw.example.test/static/downloading.mp4'],
    ['other-host absolute redirect', 'https://static.example.test/static/downloading.mp4'],
    ['relative redirect', '/static/downloading.mp4'],
    ['relative redirect with a query string', '/static/downloading.mp4?v=3&sig=abc'],
    ['other-host redirect with a query string', 'https://cdn.example.test/static/downloading.mp4?sig=abc'],
  ])('reports the downloading clip for a %s and never requests it', async (_label, location) => {
    const { client, urls } = rig([redirect(location)]);
    await expect(client.probePlayback(RAW)).resolves.toEqual({ kind: 'placeholder', name: 'downloading' });
    expect(urls).toEqual([RAW]);
  });

  it('reports the clip name of the other placeholders', async () => {
    const { client } = rig([redirect('https://cdn.example.test/static/store_limit_exceeded.mp4')]);
    await expect(client.probePlayback(RAW)).resolves.toEqual({ kind: 'placeholder', name: 'store_limit_exceeded' });
  });

  it('follows a two-hop redirect (gateway, intermediate, clip) and stops before the clip', async () => {
    const { client, urls } = rig([
      redirect('https://mid.example.test/redirect/abc?sig=1', 302),
      redirect('/static/downloading.mp4'),
    ]);
    await expect(client.probePlayback(RAW)).resolves.toEqual({ kind: 'placeholder', name: 'downloading' });
    expect(urls).toEqual([RAW, 'https://mid.example.test/redirect/abc?sig=1']);
  });

  it.each([
    ['200 with a Content-Length', new Response(null, { status: 200, headers: { 'content-length': String(4 * MB) } })],
    [
      '206 with a Content-Range total',
      new Response(null, { status: 206, headers: { 'content-range': `bytes 0-0/${4 * MB}` } }),
    ],
  ])('treats a %s far below the listed size as the downloading clip', async (_label, answer) => {
    const { client } = rig([answer]);
    await expect(client.probePlayback(RAW, { listedBytes: LISTED })).resolves.toEqual({
      kind: 'placeholder',
      name: 'downloading',
    });
  });

  it('applies the size check to the file at the end of a redirect chain', async () => {
    const { client } = rig([
      redirect('https://cdn.example.test/dl/clip.mp4?sig=1'),
      new Response(null, { status: 206, headers: { 'content-range': `bytes 0-0/${3 * MB}` } }),
    ]);
    await expect(client.probePlayback(RAW, { listedBytes: LISTED })).resolves.toEqual({
      kind: 'placeholder',
      name: 'downloading',
    });
  });
});

describe('probePlayback keeps genuine files playable', () => {
  it('returns the CDN url after a redirect to a file of the listed size', async () => {
    const target = 'https://cdn.example.test/webdl/abc/Movie.mkv?sig=1';
    const { client } = rig([
      redirect(target),
      new Response(null, { status: 206, headers: { 'content-range': `bytes 0-0/${LISTED - 5}` } }),
    ]);
    await expect(client.probePlayback(RAW, { listedBytes: LISTED })).resolves.toEqual({
      kind: 'available',
      target,
    });
  });

  it('returns the link itself when the gateway serves the bytes', async () => {
    const { client } = rig([new Response(null, { status: 206, headers: { 'content-range': `bytes 0-0/${LISTED}` } })]);
    await expect(client.probePlayback(RAW, { listedBytes: LISTED })).resolves.toEqual({
      kind: 'available',
      target: RAW,
    });
  });

  it('does not misclassify a short real title that lists a small size', async () => {
    const { client } = rig([new Response(null, { status: 200, headers: { 'content-length': String(3 * MB) } })]);
    await expect(client.probePlayback(RAW, { listedBytes: 8 * MB })).resolves.toMatchObject({ kind: 'available' });
  });

  it('judges no size when the listing or the response has none', async () => {
    const small = () => new Response(null, { status: 200, headers: { 'content-length': String(1 * MB) } });
    await expect(rig([small()]).client.probePlayback(RAW)).resolves.toMatchObject({ kind: 'available' });
    await expect(rig([small()]).client.probePlayback(RAW, { listedBytes: 0 })).resolves.toMatchObject({
      kind: 'available',
    });
    await expect(
      rig([new Response(null, { status: 200 })]).client.probePlayback(RAW, { listedBytes: LISTED }),
    ).resolves.toMatchObject({ kind: 'available' });
    const unknownTotal = new Response(null, {
      status: 206,
      headers: { 'content-range': 'bytes 0-0/*', 'content-length': '1' },
    });
    await expect(rig([unknownTotal]).client.probePlayback(RAW, { listedBytes: LISTED })).resolves.toMatchObject({
      kind: 'available',
    });
  });

  it('settles for the redirect target when a later hop cannot be reached', async () => {
    const target = 'https://cdn.example.test/webdl/abc/Movie.mkv?sig=1';
    for (const second of [new TypeError('fetch failed'), new Response(null, { status: 503 })]) {
      const { client } = rig([redirect(target), second]);
      await expect(client.probePlayback(RAW, { listedBytes: LISTED })).resolves.toEqual({
        kind: 'available',
        target,
      });
    }
  });

  it('still reports the first-hop failures', async () => {
    await expect(rig([new Response(null, { status: 429 })]).client.probePlayback(RAW)).resolves.toEqual({
      kind: 'rate_limited',
    });
    await expect(rig([new Response(null, { status: 500 })]).client.probePlayback(RAW)).resolves.toEqual({
      kind: 'failed',
      status: 500,
    });
    await expect(rig([redirect('')]).client.probePlayback(RAW)).resolves.toEqual({ kind: 'failed', status: 307 });
  });

  it('gives up on a redirect loop instead of following it forever', async () => {
    const { client, urls } = rig(Array.from({ length: 20 }, () => redirect('https://loop.example.test/again')));
    await expect(client.probePlayback(RAW)).resolves.toEqual({ kind: 'failed', status: 307 });
    expect(urls.length).toBeLessThanOrEqual(9);
  });
});

describe('probePlayback debug line', () => {
  it('logs one line with the redirect shape and no URL, host name, token or file name', async () => {
    const { client, debug } = rig([
      redirect('https://mid.example.test/redirect/abc?sig=SECRETSIG', 302),
      redirect('/static/downloading.mp4?token=SECRETTOKEN'),
    ]);
    await client.probePlayback(RAW);

    expect(debug).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(debug.mock.calls[0]);
    expect(logged).toContain('other');
    expect(logged).toContain('/static/<word>.mp4');
    expect(logged).toContain('302');
    for (const needle of ['example.test', 'mid.', 'SECRETSIG', 'SECRETTOKEN', 'tok-secret', 'Movie.1994', 'http']) {
      expect(logged).not.toContain(needle);
    }
  });

  it('logs the shape of a direct answer and of a relative redirect as the same host', async () => {
    const relative = rig([redirect('/hop/7?x=1'), new Response(null, { status: 206 })]);
    await relative.client.probePlayback(RAW);
    const logged = JSON.stringify(relative.debug.mock.calls);
    expect(relative.debug).toHaveBeenCalledTimes(1);
    expect(logged).toContain('same');
    expect(logged).toContain('/<word>/<num>');

    const direct = rig([new Response(null, { status: 206 })]);
    await direct.client.probePlayback(RAW);
    expect(direct.debug).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(direct.debug.mock.calls)).toContain('206');
  });
});
