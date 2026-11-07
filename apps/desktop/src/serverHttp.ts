import { withRequestId } from './requestId.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ServerClient {
  readonly origin: string;
  /** A request to the HomeStream server; it always carries a fresh `X-Request-ID`. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Who answers on this port: HomeStream, some other program, or nobody. */
  probe(timeoutMs?: number): Promise<'homestream' | 'other' | 'none'>;
  getJson(path: string, timeoutMs?: number): Promise<unknown>;
}

const DEFAULT_TIMEOUT_MS = 3000;

/** Every call the main process makes to the server goes through this client, so none can miss its request id. */
export function createServerClient(port: number, fetchImpl: FetchLike = (url, init) => fetch(url, init)): ServerClient {
  const origin = `http://127.0.0.1:${port}`;
  const client: ServerClient = {
    origin,
    fetch(path, init = {}) {
      const headers = withRequestId(Object.fromEntries(new Headers(init.headers).entries()));
      return fetchImpl(`${origin}${path}`, { ...init, headers });
    },
    async probe(timeoutMs = DEFAULT_TIMEOUT_MS) {
      try {
        const response = await client.fetch('/api/info', { signal: AbortSignal.timeout(timeoutMs) });
        const body = (await response.json()) as { app?: unknown };
        return body.app === 'homestream' ? 'homestream' : 'other';
      } catch (error) {
        // An answer that is not JSON still means another program holds the port; a refused connection means nobody does.
        return error instanceof SyntaxError ? 'other' : 'none';
      }
    },
    async getJson(path, timeoutMs = DEFAULT_TIMEOUT_MS) {
      const response = await client.fetch(path, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`The server answered ${response.status}.`);
      return response.json();
    },
  };
  return client;
}
