import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { attachLogSink, type LogEntry } from '../logger';
import { ApiError, REQUEST_ID_HEADER, apiFetch, apiGet } from './client';

const numberDoc = {
  parse(value: unknown): { n: number } {
    const n = (value as { n?: unknown }).n;
    if (typeof n !== 'number') throw new TypeError('n must be a number');
    return { n };
  },
};

function stubFetch(result: Response | Error) {
  const fetchMock = vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('apiFetch', () => {
  const entries: LogEntry[] = [];
  const detach = attachLogSink((entry) => entries.push(entry));
  afterEach(() => {
    vi.unstubAllGlobals();
    entries.length = 0;
  });
  afterAll(detach);

  it('adds a fresh X-Request-ID to every call and keeps the caller headers', async () => {
    const fetchMock = stubFetch(Response.json({}));
    await apiFetch('/api/a', { headers: { 'X-Device-Id': 'tv' } });
    await apiFetch('/api/b', { method: 'post' });
    const sent = fetchMock.mock.calls.map((call) => new Headers((call as unknown as [string, RequestInit])[1].headers));
    expect(sent[0]?.get('X-Device-Id')).toBe('tv');
    const [first, second] = sent.map((headers) => headers.get(REQUEST_ID_HEADER));
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
    expect(entries.map((entry) => entry.message)).toEqual(['GET /api/a -> 200', 'POST /api/b -> 200']);
  });

  it('still sends a UUID request id on a plain-HTTP origin where crypto.randomUUID is undefined', async () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const fetchMock = stubFetch(Response.json({}));
    await apiFetch('/api/a');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get(REQUEST_ID_HEADER)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('turns an error body into an ApiError with the request id', async () => {
    stubFetch(
      Response.json({ error: { code: 'not_found', message: 'No such title', hint: 'Search again' } }, { status: 404 }),
    );
    const error = await apiFetch('/api/titles/1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'No such title', hint: 'Search again' });
    expect((error as ApiError).requestId).toBeTruthy();
    expect(entries[0]).toMatchObject({ level: 'warn', message: 'GET /api/titles/1 -> 404' });
  });

  it('falls back to the status line when the body is not JSON', async () => {
    stubFetch(new Response('<html>', { status: 502 }));
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ status: 502, code: 'http_error' });
  });

  it('logs and rethrows a network failure', async () => {
    stubFetch(new TypeError('offline'));
    await expect(apiFetch('/api/x')).rejects.toThrow('offline');
    expect(entries[0]).toMatchObject({ level: 'warn', message: 'GET /api/x failed' });
  });
});

describe('apiGet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('validates the document with the given schema', async () => {
    stubFetch(Response.json({ n: 1 }));
    await expect(apiGet('/api/n', numberDoc)).resolves.toEqual({ n: 1 });
    stubFetch(Response.json({ n: 'one' }));
    await expect(apiGet('/api/n', numberDoc)).rejects.toThrow();
  });

  it('passes an abort signal on', async () => {
    const fetchMock = stubFetch(Response.json({}));
    const controller = new AbortController();
    await apiGet('/api/n', { parse: (value: unknown) => value }, controller.signal);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(controller.signal);
  });
});
