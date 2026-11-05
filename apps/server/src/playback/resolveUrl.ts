import { AppError } from '../errors.js';
import { redact } from '../redact.js';

export type UrlResolver = (rawUrl: string) => Promise<string>;
export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export const RESOLVE_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 8;

function unavailable(reason: string): AppError {
  return new AppError(
    502,
    'stream_unavailable',
    redact(`Could not open the selected stream: ${reason}`),
    'Pick another stream (a cached ⚡ one is fastest), or check the TorBox account on the health dashboard.',
  );
}

/**
 * Follows the gateway link to the final TorBox CDN URL with a one-byte ranged GET. Redirects are followed by hand so the
 * intermediate URLs (which carry secrets) never end up in an error message.
 */
export function createUrlResolver(fetchImpl: FetchImpl = (url, init) => fetch(url, init), timeoutMs = RESOLVE_TIMEOUT_MS): UrlResolver {
  return async (rawUrl) => {
    const signal = AbortSignal.timeout(timeoutMs);
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let response: Response;
      try {
        response = await fetchImpl(current, { method: 'GET', redirect: 'manual', headers: { Range: 'bytes=0-0' }, signal });
      } catch (error) {
        if (signal.aborted) throw unavailable(`no answer within ${Math.round(timeoutMs / 1000)} seconds`);
        throw unavailable((error as Error).message);
      }
      await response.body?.cancel().catch(() => undefined);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw unavailable(`redirect without a target (HTTP ${response.status})`);
        current = new URL(location, current).toString();
        continue;
      }
      if (response.status === 200 || response.status === 206) return current;
      throw unavailable(`HTTP ${response.status}`);
    }
    throw unavailable('too many redirects');
  };
}
