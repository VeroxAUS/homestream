import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
      if (url.startsWith('https://gw.example.test')) return response(307, { location: 'https://store-001.wnam.tb-cdn.io/file.mkv?token=abc' });
      return response(206);
    };
    const resolve = createUrlResolver(fetchImpl);
    await expect(resolve('https://gw.example.test/playback/gw-secret-token/file')).resolves.toBe('https://store-001.wnam.tb-cdn.io/file.mkv?token=abc');
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
      statusCode: 502, code: 'stream_unavailable', message: expect.stringContaining('HTTP 503'), hint: expect.stringContaining('Pick another stream'),
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
    await expect(loop('https://gw.example.test/a')).rejects.toMatchObject({ message: expect.stringContaining('too many redirects') });
    const bare = createUrlResolver(async () => response(302));
    await expect(bare('https://gw.example.test/a')).rejects.toMatchObject({ message: expect.stringContaining('redirect without a target') });
  });

  it('times out with a clear message', async () => {
    const resolve = createUrlResolver((_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }), 50);
    await expect(resolve('https://gw.example.test/a')).rejects.toMatchObject({ message: expect.stringContaining('no answer within') });
  });
});
