import { describe, expect, it } from 'vitest';
import { createServerClient } from '../src/serverHttp.js';
import { createSseParser, type SseMessage } from '../src/sse.js';

describe('createServerClient', () => {
  function client(handler: (url: string, init: RequestInit) => Promise<Response>) {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const server = createServerClient(8610, (url, init = {}) => {
      calls.push({ url, headers: new Headers(init.headers) });
      return handler(url, init);
    });
    return { server, calls };
  }

  it('puts a fresh X-Request-ID on every call and keeps the caller headers', async () => {
    const { server, calls } = client(() => Promise.resolve(Response.json({})));
    await server.fetch('/api/events', { headers: { Accept: 'text/event-stream' } });
    await server.fetch('/api/health');
    await server.getJson('/api/activity');
    await server.probe();
    expect(calls).toHaveLength(4);
    const ids = calls.map((call) => call.headers.get('x-request-id'));
    expect(ids.every((id) => typeof id === 'string' && id.length >= 8)).toBe(true);
    expect(new Set(ids).size).toBe(4);
    expect(calls[0]?.headers.get('accept')).toBe('text/event-stream');
    expect(calls[0]?.url).toBe('http://127.0.0.1:8610/api/events');
    expect(server.origin).toBe('http://127.0.0.1:8610');
  });

  it('tells HomeStream, another program and nobody apart', async () => {
    expect(await client(() => Promise.resolve(Response.json({ app: 'homestream' }))).server.probe()).toBe('homestream');
    expect(await client(() => Promise.resolve(Response.json({ app: 'other' }))).server.probe()).toBe('other');
    expect(await client(() => Promise.resolve(new Response('<html>'))).server.probe()).toBe('other');
    expect(await client(() => Promise.reject(new TypeError('fetch failed'))).server.probe()).toBe('none');
  });

  it('throws for an error answer', async () => {
    const { server } = client(() => Promise.resolve(new Response('no', { status: 503 })));
    await expect(server.getJson('/api/health')).rejects.toThrow('503');
  });
});

describe('createSseParser', () => {
  it('assembles messages across chunks and skips comments', () => {
    const seen: SseMessage[] = [];
    const feed = createSseParser((message) => seen.push(message));
    feed(': hello\n\nevent: heartbeat\ndata: {"a"');
    feed(':1}\n\nevent: health\r\ndata: one\r\ndata: two\r\n\r\n');
    feed('data: bare\n\nretry: 5000\n\n');
    expect(seen).toEqual([
      { event: 'heartbeat', data: '{"a":1}' },
      { event: 'health', data: 'one\ntwo' },
      { event: 'message', data: 'bare' },
    ]);
  });
});
