import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppError } from '../../src/errors.js';
import { clearSecrets, registerSecret } from '../../src/redact.js';
import { createUrlResolver, type FetchImpl } from '../../src/playback/resolveUrl.js';

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

beforeEach(() => registerSecret('gw-secret-token'));
afterEach(() => clearSecrets());

describe('createUrlResolver', () => {
  it('follows redirects by hand with a one-byte range request and returns the final CDN url', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: FetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (url.startsWith('https://gw.example.test'))
        return response(307, { location: 'https://store-001.wnam.tb-cdn.io/file.mkv?token=abc' });
      return response(206);
    };
    const resolve = createUrlResolver(fetchImpl);
    await expect(resolve('https://gw.example.test/playback/gw-secret-token/file')).resolves.toBe(
      'https://store-001.wnam.tb-cdn.io/file.mkv?token=abc',
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]?.init).toMatchObject({ method: 'GET', redirect: 'manual', headers: { Range: 'bytes=0-0' } });
  });

  it('resolves relative redirects and returns the input when there is no redirect', async () => {
    const hops = [response(302, { location: '/next/file' }), response(200)];
    const urls: string[] = [];
    const resolve = createUrlResolver(async (url) => {
      urls.push(url);
      return hops.shift() as Response;
    });
    await expect(resolve('https://gw.example.test/a')).resolves.toBe('https://gw.example.test/next/file');
    expect(urls).toEqual(['https://gw.example.test/a', 'https://gw.example.test/next/file']);
  });

  it('fails with a redacted, actionable error for HTTP errors', async () => {
    const resolve = createUrlResolver(async () => response(503));
    await expect(resolve('https://gw.example.test/gw-secret-token')).rejects.toMatchObject({
      statusCode: 502,
      code: 'stream_unavailable',
      message: expect.stringContaining('HTTP 503'),
      hint: expect.stringContaining('TorBox account'),
    });
  });

  describe('placeholder clips', () => {
    const cases: Array<[string, number, string]> = [
      ['downloading', 409, 'stream_not_cached'],
      ['store_limit_exceeded', 409, 'torbox_slots_full'],
      ['429', 429, 'gateway_rate_limited'],
      ['download_failed', 502, 'stream_unavailable'],
      ['no_matching_file', 502, 'stream_unavailable'],
      ['Some_New_Reason', 502, 'stream_unavailable'],
    ];

    it.each(cases)('maps /static/%s.mp4 to %i %s and never requests the clip', async (name, status, code) => {
      const urls: string[] = [];
      const resolve = createUrlResolver(async (url) => {
        urls.push(url);
        return response(307, { location: `/static/${name}.mp4` });
      });
      const error = await resolve('https://gw.example.test/api/v1/debrid/playback/gw-secret-token/x').catch(
        (e: unknown) => e,
      );
      expect(error).toMatchObject({ statusCode: status, code, hint: expect.any(String) });
      expect(urls).toHaveLength(1);
      expect(JSON.stringify(error)).not.toContain('gw-secret-token');
      expect((error as Error).message).not.toContain('gw-secret-token');
    });

    it('detects an absolute redirect to the gateway host, also after another hop', async () => {
      const hops = [
        response(302, { location: 'https://gw.example.test/api/v1/debrid/playback/next' }),
        response(307, { location: 'https://gw.example.test/static/downloading.mp4' }),
      ];
      const urls: string[] = [];
      const resolve = createUrlResolver(async (url) => {
        urls.push(url);
        return hops.shift() as Response;
      });
      await expect(resolve('https://gw.example.test/a')).rejects.toMatchObject({ code: 'stream_not_cached' });
      expect(urls).toHaveLength(2);
    });

    it('leaves a static mp4 on another host (a CDN file) alone', async () => {
      const resolve = createUrlResolver(async (url) =>
        url.startsWith('https://gw.example.test')
          ? response(307, { location: 'https://cdn.example.test/static/downloading.mp4' })
          : response(206),
      );
      await expect(resolve('https://gw.example.test/a')).resolves.toBe(
        'https://cdn.example.test/static/downloading.mp4',
      );
    });

    it('stops at the placeholder over real HTTP: the clip is never requested, a control path resolves to the file', async () => {
      const requested: string[] = [];
      const server = http.createServer((req, res) => {
        requested.push(req.url ?? '');
        const redirects: Record<string, string> = {
          '/playback/downloading': '/static/downloading.mp4',
          '/playback/store': '/static/store_limit_exceeded.mp4',
          '/playback/ratelimit': '/static/429.mp4',
          '/playback/failed': '/static/download_failed.mp4',
          '/playback/control': '/cdn/movie.mkv',
        };
        const target = redirects[req.url ?? ''];
        if (target) res.writeHead(307, { location: target }).end();
        else res.writeHead(206, { 'content-type': 'video/mp4' }).end('x');
      });
      await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      try {
        const resolve = createUrlResolver();
        const codes: Record<string, string> = {};
        for (const name of ['downloading', 'store', 'ratelimit', 'failed']) {
          codes[name] = await resolve(`${base}/playback/${name}`).then(
            () => 'resolved',
            (error: AppError) => error.code,
          );
        }
        expect(codes).toEqual({
          downloading: 'stream_not_cached',
          store: 'torbox_slots_full',
          ratelimit: 'gateway_rate_limited',
          failed: 'stream_unavailable',
        });
        expect(requested.some((url) => url.startsWith('/static/'))).toBe(false);
        await expect(resolve(`${base}/playback/control`)).resolves.toBe(`${base}/cdn/movie.mkv`);
      } finally {
        server.closeAllConnections();
        await new Promise((resolveClose) => server.close(resolveClose));
      }
    });

    it('does not treat other gateway paths as placeholders', async () => {
      const resolve = createUrlResolver(async (url) =>
        url.endsWith('/a') ? response(307, { location: '/static/readme.txt' }) : response(206),
      );
      await expect(resolve('https://gw.example.test/a')).resolves.toBe('https://gw.example.test/static/readme.txt');
    });
  });

  it('never leaks the url in network errors', async () => {
    const resolve = createUrlResolver(async (url) => {
      throw new TypeError(`fetch failed for ${url}`);
    });
    const error = await resolve('https://gw.example.test/gw-secret-token').catch((e: Error) => e);
    expect((error as Error).message).not.toContain('gw-secret-token');
  });

  it('stops after too many redirects and on a redirect without a target', async () => {
    const loop = createUrlResolver(async () => response(302, { location: 'https://gw.example.test/loop' }));
    await expect(loop('https://gw.example.test/a')).rejects.toMatchObject({
      message: expect.stringContaining('too many redirects'),
    });
    const bare = createUrlResolver(async () => response(302));
    await expect(bare('https://gw.example.test/a')).rejects.toMatchObject({
      message: expect.stringContaining('redirect without a target'),
    });
  });

  it('times out with a clear message', async () => {
    const resolve = createUrlResolver(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
      50,
    );
    await expect(resolve('https://gw.example.test/a')).rejects.toMatchObject({
      message: expect.stringContaining('no answer within'),
    });
  });
});
