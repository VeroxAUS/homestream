import { AppError } from '../errors.js';
import { redact } from '../redact.js';

export type UrlResolver = (rawUrl: string) => Promise<string>;
export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

const RESOLVE_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 8;

function unavailable(reason: string): AppError {
  return new AppError(
    502,
    'stream_unavailable',
    redact(`Could not open the selected stream: ${reason}`),
    'Try again in a moment. If it keeps failing, check the TorBox account on the health dashboard.',
  );
}

const PLACEHOLDER_PATH = /^\/static\/([^/]+)\.mp4$/i;

/** Lower-case clip name (`downloading`, `429`, ...) when `target` is one of the gateway's placeholder clips, else null. */
export function placeholderName(target: URL, gatewayHost: string): string | null {
  if (target.host !== gatewayHost) return null;
  const match = PLACEHOLDER_PATH.exec(target.pathname);
  return match ? (match[1] as string).toLowerCase() : null;
}

/**
 * When the gateway cannot serve a file it redirects to a short clip of its own (`/static/<reason>.mp4`) instead of failing.
 * Returns the error for that clip, or null when `target` is something else.
 */
function placeholderError(target: URL, gatewayHost: string): AppError | null {
  const name = placeholderName(target, gatewayHost);
  if (!name) return null;
  switch (name) {
    case 'downloading':
      return new AppError(
        409,
        'stream_not_cached',
        'This stream is not cached on TorBox yet.',
        'TorBox has to download it first. Try again later, or play a title that shows the ⚡ cached mark.',
      );
    case 'store_limit_exceeded':
      return new AppError(
        409,
        'torbox_slots_full',
        'TorBox has no free download slots right now.',
        'Wait for a running TorBox download to finish or remove one in the TorBox dashboard, then try again.',
      );
    case '429':
      return new AppError(
        429,
        'gateway_rate_limited',
        'The stream gateway is rate limited right now.',
        'Wait a minute and try again.',
      );
    default:
      return unavailable('the gateway has no playable file for it');
  }
}

/**
 * Follows the gateway link to the final TorBox CDN URL with a one-byte ranged GET. Redirects are followed by hand so the
 * intermediate URLs (which carry secrets) never end up in an error message, and so a redirect to one of the gateway's
 * placeholder clips is stopped before the clip is requested.
 */
export function createUrlResolver(
  fetchImpl: FetchImpl = (url, init) => fetch(url, init),
  timeoutMs = RESOLVE_TIMEOUT_MS,
): UrlResolver {
  return async (rawUrl) => {
    const signal = AbortSignal.timeout(timeoutMs);
    let current = rawUrl;
    let gatewayHost: string;
    try {
      gatewayHost = new URL(rawUrl).host;
    } catch {
      throw unavailable('the stream link is not a valid URL');
    }
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let response: Response;
      try {
        response = await fetchImpl(current, {
          method: 'GET',
          redirect: 'manual',
          headers: { Range: 'bytes=0-0' },
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw unavailable(`no answer within ${Math.round(timeoutMs / 1000)} seconds`);
        throw unavailable((error as Error).message);
      }
      await response.body?.cancel().catch(() => undefined);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw unavailable(`redirect without a target (HTTP ${response.status})`);
        const next = new URL(location, current);
        const placeholder = placeholderError(next, gatewayHost);
        if (placeholder) throw placeholder;
        current = next.toString();
        continue;
      }
      if (response.status === 200 || response.status === 206) return current;
      throw unavailable(`HTTP ${response.status}`);
    }
    throw unavailable('too many redirects');
  };
}
