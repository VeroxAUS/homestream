import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

type Handler = (request: { url: URL; init: RequestInit | undefined }) => unknown;
export type Reply = unknown | Handler;

interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

/**
 * Replaces `fetch` with a table of `"METHOD /path?query"` (or `"METHOD /path"`) to reply. A reply is JSON, a `Response`,
 * an `Error` (the request fails) or a function returning one of those. Unlisted requests answer 404 like the server.
 */
export function mockApi(routes: Record<string, Reply>) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({
      method,
      path: `${url.pathname}${url.search}`,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const entry = routes[`${method} ${url.pathname}${url.search}`] ?? routes[`${method} ${url.pathname}`];
    if (entry === undefined) {
      return Response.json({ error: { code: 'not_found', message: 'No route.' } }, { status: 404 });
    }
    const value = typeof entry === 'function' ? await (entry as Handler)({ url, init }) : entry;
    if (value instanceof Error) throw value;
    return value instanceof Response ? value : Response.json(value);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

export function apiError(status: number, code: string, message: string, hint?: string): Response {
  return Response.json({ error: { code, message, ...(hint ? { hint } : {}) } }, { status });
}

export function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

export function renderWithProviders(ui: ReactElement, path = '/', queryClient = testQueryClient()) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}
