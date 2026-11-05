import type { Db } from '../db/index.js';
import type { GatewayStream } from './types.js';

export const GATEWAY_TTL_MS = 60 * 60 * 1000;
/** Empty lists are usually "not released / not indexed yet", so they are retried sooner. */
export const GATEWAY_EMPTY_TTL_MS = 5 * 60 * 1000;
const PURGE_AFTER_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedLookup {
  key: string;
  streams: GatewayStream[];
  expiresAt: number;
}

interface Row {
  key: string;
  json: string;
  expires_at: number;
}

function parseRow(row: Row): CachedLookup | undefined {
  try {
    const streams = JSON.parse(row.json) as GatewayStream[];
    if (!Array.isArray(streams)) return undefined;
    return { key: row.key, streams, expiresAt: row.expires_at };
  } catch {
    return undefined;
  }
}

/**
 * Expired rows are kept (until purged) so a stream id can still be traced back to the lookup that produced it
 * and the list can be re-fetched.
 */
export class GatewayCache {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns the entry even when expired; callers compare `expiresAt`. */
  get(key: string): CachedLookup | undefined {
    const row = this.db.prepare('SELECT key, json, expires_at FROM gateway_cache WHERE key = ?').get(key) as
      | Row
      | undefined;
    return row ? parseRow(row) : undefined;
  }

  isFresh(entry: CachedLookup): boolean {
    return entry.expiresAt > this.now();
  }

  getFresh(key: string): CachedLookup | undefined {
    const entry = this.get(key);
    return entry && this.isFresh(entry) ? entry : undefined;
  }

  set(key: string, streams: GatewayStream[]): void {
    const ttl = streams.length > 0 ? GATEWAY_TTL_MS : GATEWAY_EMPTY_TTL_MS;
    this.db
      .prepare(
        'INSERT INTO gateway_cache (key, json, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, expires_at = excluded.expires_at',
      )
      .run(key, JSON.stringify(streams), this.now() + ttl);
  }

  /** `id` is 16 hex chars, so embedding it in a LIKE pattern is safe. */
  findByStreamId(id: string): CachedLookup | undefined {
    if (!/^[0-9a-f]{16}$/.test(id)) return undefined;
    const rows = this.db
      .prepare('SELECT key, json, expires_at FROM gateway_cache WHERE json LIKE ? ORDER BY expires_at DESC')
      .all(`%"id":"${id}"%`) as unknown as Row[];
    for (const row of rows) {
      const entry = parseRow(row);
      if (entry?.streams.some((stream) => stream.id === id)) return entry;
    }
    return undefined;
  }

  purgeExpired(): void {
    this.db.prepare('DELETE FROM gateway_cache WHERE expires_at <= ?').run(this.now() - PURGE_AFTER_EXPIRY_MS);
  }
}
