import { clipSizeImplausible, placeholderName, redirectShape, type RedirectShape } from '../playback/placeholder.js';
import { GATEWAY_USER_AGENT } from './types.js';

export type GatewayFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal; method?: string; redirect?: 'manual' | 'follow' },
) => Promise<Response>;

/**
 * What a stream's playback link showed, read from the answers the redirects led to (a placeholder clip is never requested).
 * `placeholder` carries the clip name: `downloading`, `store_limit_exceeded`, `429`, ...
 * `available` carries `target`, where the link leads (the last URL that answered with bytes, or the link itself when the
 * gateway served them). It is a secret-bearing URL: callers may hand it to the source proxy but never log or return it.
 */
export type PlaybackProbe =
  | { kind: 'placeholder'; name: string }
  | { kind: 'available'; target: string }
  | { kind: 'timeout' }
  | { kind: 'rate_limited' }
  | { kind: 'failed'; status: number | null };

export interface PlaybackProbeOptions {
  /** The size the stream is listed with; a file far below it is the gateway's clip served without a redirect. */
  listedBytes?: number;
}

export interface PlaybackProbeResult {
  probe: PlaybackProbe;
  /** One entry per answer, with nothing in it that identifies a host, token or file. */
  hops: Array<RedirectShape | { status: number }>;
}

const MAX_HOPS = 8;

type Step =
  | { kind: 'redirect'; status: number; next: URL }
  | { kind: 'answer'; status: number; bytes: number | null }
  | { kind: 'broken'; status: number }
  | { kind: 'network'; timedOut: boolean };

/** The size of the whole file: a 206 says it in Content-Range (its Content-Length is the one requested byte), a 200 in Content-Length. */
function totalBytes(response: Response): number | null {
  const range = /\/(\d+)\s*$/.exec(response.headers.get('content-range') ?? '');
  const length = Number(response.status === 206 ? range?.[1] : (response.headers.get('content-length') ?? Number.NaN));
  return Number.isFinite(length) && length > 0 ? length : null;
}

async function request(fetchImpl: GatewayFetch, url: string, signal: AbortSignal): Promise<Step> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { Range: 'bytes=0-0', 'User-Agent': GATEWAY_USER_AGENT },
      signal,
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return { kind: 'network', timedOut };
  }
  await response.body?.cancel().catch(() => undefined);
  const { status } = response;
  if (status >= 300 && status < 400) {
    const location = response.headers.get('location');
    if (!location || !URL.canParse(location, url)) return { kind: 'broken', status };
    return { kind: 'redirect', status, next: new URL(location, url) };
  }
  return { kind: 'answer', status, bytes: totalBytes(response) };
}

/** What a failed first request means; a later hop that cannot be judged leaves the decision to the source proxy. */
function inconclusive(step: Step, hop: number, current: string): PlaybackProbe {
  if (hop > 0) return { kind: 'available', target: current };
  if (step.kind === 'network') return step.timedOut ? { kind: 'timeout' } : { kind: 'failed', status: null };
  if (step.kind === 'answer' && step.status === 429) return { kind: 'rate_limited' };
  return { kind: 'failed', status: step.status };
}

/**
 * Asks the gateway for a stream's playback link and follows the redirects by hand, one ranged byte each, checking every
 * Location before it is requested. An uncached link makes AIOStreams add the item to TorBox and answer with its
 * `downloading.mp4` clip: as a redirect (on the gateway or any other host, absolute or relative, behind any number of
 * hops), or as a short file served directly.
 */
export async function probePlaybackLink(
  fetchImpl: GatewayFetch,
  rawUrl: string,
  timeoutMs: number,
  options: PlaybackProbeOptions = {},
): Promise<PlaybackProbeResult> {
  const signal = AbortSignal.timeout(timeoutMs);
  const hops: PlaybackProbeResult['hops'] = [];
  let current = rawUrl;
  let lastStatus: number | null = null;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const step = await request(fetchImpl, current, signal);
    if (step.kind === 'redirect') {
      hops.push(redirectShape(step.status, step.next, current));
      lastStatus = step.status;
      const clip = placeholderName(step.next);
      if (clip) return { probe: { kind: 'placeholder', name: clip }, hops };
      current = step.next.toString();
      continue;
    }
    if (step.kind === 'answer') hops.push({ status: step.status });
    if (step.kind === 'answer' && (step.status === 200 || step.status === 206)) {
      const clip = clipSizeImplausible(options.listedBytes ?? 0, step.bytes);
      return {
        probe: clip ? { kind: 'placeholder', name: 'downloading' } : { kind: 'available', target: current },
        hops,
      };
    }
    return { probe: inconclusive(step, hop, current), hops };
  }
  return { probe: { kind: 'failed', status: lastStatus }, hops };
}
