import type { TorboxItem } from './rules.js';

export const TORBOX_LIST_TIMEOUT_MS = 30_000;

export type TorboxFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

/** `auth`: the key was refused. `unavailable`: network failure, rate limit, TorBox error or an unreadable answer. */
export class TorboxError extends Error {
  constructor(
    readonly kind: 'auth' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'TorboxError';
  }
}

function toItem(raw: unknown): TorboxItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.hash !== 'string' || !item.hash) return null;
  const progress = Number(item.progress);
  const eta = Number(item.eta);
  const alternatives = Array.isArray(item.alternative_hashes) ? item.alternative_hashes : [];
  return {
    hash: item.hash.toLowerCase(),
    alternativeHashes: alternatives
      .filter((hash): hash is string => typeof hash === 'string')
      .map((hash) => hash.toLowerCase()),
    name: typeof item.name === 'string' ? item.name : '',
    downloadState: typeof item.download_state === 'string' ? item.download_state : '',
    progress: Number.isFinite(progress) ? progress : 0,
    etaSec: Number.isFinite(eta) && eta >= 0 ? Math.round(eta) : null,
    downloadFinished: item.download_finished === true,
    downloadPresent: item.download_present === true,
  };
}

export function parseMylist(body: unknown): TorboxItem[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new TorboxError('unavailable', 'the list has no data array');
  return data.map(toItem).filter((item): item is TorboxItem => item !== null);
}

export interface TorboxClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: TorboxFetch;
  timeoutMs?: number;
}

/** Read-only: the server never adds, controls or deletes TorBox items itself (AIOStreams adds them). */
export class TorboxClient {
  private readonly fetchImpl: TorboxFetch;

  constructor(private readonly options: TorboxClientOptions) {
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  }

  async list(): Promise<TorboxItem[]> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}/v1/api/torrents/mylist?bypass_cache=true`, {
        headers: { Authorization: `Bearer ${this.options.apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? TORBOX_LIST_TIMEOUT_MS),
      });
    } catch {
      throw new TorboxError('unavailable', 'TorBox did not answer');
    }
    if (response.status === 401 || response.status === 403)
      throw new TorboxError('auth', `TorBox refused the API key (HTTP ${response.status})`);
    if (!response.ok) throw new TorboxError('unavailable', `TorBox answered HTTP ${response.status}`);
    try {
      return parseMylist(await response.json());
    } catch (error) {
      throw error instanceof TorboxError ? error : new TorboxError('unavailable', 'TorBox sent an unreadable answer');
    }
  }
}
