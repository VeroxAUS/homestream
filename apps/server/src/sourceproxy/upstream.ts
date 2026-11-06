import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';

const MAX_REDIRECTS = 3;
const SOCKET_IDLE_TIMEOUT_MS = 30_000;

export class UpstreamStatusError extends Error {
  constructor(readonly status: number) {
    super(`upstream answered HTTP ${status}`);
    this.name = 'UpstreamStatusError';
  }
}

export class UpstreamNetworkError extends Error {
  constructor(readonly code: string) {
    super(`upstream connection failed (${code})`);
    this.name = 'UpstreamNetworkError';
  }
}

/** The link no longer works as it is: re-resolving the gateway URL is the fix. */
export function needsNewLink(error: unknown): boolean {
  return error instanceof UpstreamStatusError && [401, 403, 404, 410].includes(error.status);
}

export function isAbort(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'AbortError' || (error as NodeJS.ErrnoException).code === 'ABORT_ERR')
  );
}

/**
 * Keep-alive HTTP(S) client for ranged reads. Messages are never put into errors with the URL, so the CDN link cannot leak
 * through a log line.
 */
export class UpstreamClient {
  private readonly httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32 });
  private readonly httpAgent = new http.Agent({ keepAlive: true, maxSockets: 32 });

  /** Resolves with the response once its status is 200/206; the caller owns the body stream. */
  async request(url: string, range: string, signal?: AbortSignal): Promise<IncomingMessage> {
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await this.once(target, range, signal);
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        target = new URL(response.headers.location, target).toString();
        continue;
      }
      if (status === 200 || status === 206) return response;
      response.resume();
      throw new UpstreamStatusError(status);
    }
    throw new UpstreamNetworkError('too_many_redirects');
  }

  close(): void {
    this.httpsAgent.destroy();
    this.httpAgent.destroy();
  }

  private once(url: string, range: string, signal?: AbortSignal): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const secure = target.protocol === 'https:';
      const request = (secure ? https : http).request(
        target,
        { method: 'GET', agent: secure ? this.httpsAgent : this.httpAgent, headers: { Range: range }, signal },
        resolve,
      );
      request.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () =>
        request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
      );
      request.on('error', (error: NodeJS.ErrnoException) => {
        if (isAbort(error)) reject(error);
        else reject(new UpstreamNetworkError(error.code ?? 'ERROR'));
      });
      request.end();
    });
  }
}

export interface RangeInfo {
  start: number;
  /** Total size of the resource; null when the server did not say. */
  total: number | null;
}

/** Parses `bytes a-b/total` (206) or the full-body case (200, start 0). */
export function rangeInfo(response: IncomingMessage): RangeInfo | null {
  if (response.statusCode === 200) {
    const length = Number(response.headers['content-length']);
    return { start: 0, total: Number.isFinite(length) && length > 0 ? length : null };
  }
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(response.headers['content-range'] ?? ''));
  if (!match) return null;
  return { start: Number(match[1]), total: match[3] === '*' ? null : Number(match[3]) };
}

/**
 * Copies the body into `target` as it arrives, reporting how many bytes are valid after every chunk. Returns the total.
 * `beforeChunk` is awaited with the size of each chunk before it is kept, which is where the download cap holds a reader back.
 */
export async function readInto(
  response: IncomingMessage,
  target: Buffer,
  onProgress: (filled: number) => void,
  beforeChunk?: (bytes: number) => Promise<void>,
): Promise<number> {
  let filled = 0;
  // A body that fits is read to its end so the keep-alive socket goes back to the pool instead of being torn down.
  const expected = Number(response.headers['content-length']);
  const drainAll = Number.isFinite(expected) && expected <= target.length;
  try {
    for await (const chunk of response as AsyncIterable<Buffer>) {
      const take = Math.min(chunk.length, target.length - filled);
      if (beforeChunk) await beforeChunk(chunk.length);
      if (take > 0) {
        chunk.copy(target, filled, 0, take);
        filled += take;
        onProgress(filled);
      }
      if (filled >= target.length && !drainAll) break;
    }
  } finally {
    if (!response.complete) response.destroy();
  }
  return filled;
}
