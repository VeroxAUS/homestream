import type { Db } from '../db/index.js';

export const TTL_MS = {
  list: 60 * 60 * 1000,
  details: 24 * 60 * 60 * 1000,
  config: 24 * 60 * 60 * 1000,
  search: 10 * 60 * 1000,
  recommendations: 24 * 60 * 60 * 1000,
} as const;

export class TmdbCache {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): unknown | undefined {
    const row = this.db.prepare('SELECT json, expires_at FROM tmdb_cache WHERE key = ?').get(key) as
      { json: string; expires_at: number } | undefined;
    if (!row) return undefined;
    if (row.expires_at <= this.now()) {
      this.db.prepare('DELETE FROM tmdb_cache WHERE key = ?').run(key);
      return undefined;
    }
    try {
      return JSON.parse(row.json) as unknown;
    } catch {
      this.db.prepare('DELETE FROM tmdb_cache WHERE key = ?').run(key);
      return undefined;
    }
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.db
      .prepare(
        'INSERT INTO tmdb_cache (key, json, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, expires_at = excluded.expires_at',
      )
      .run(key, JSON.stringify(value), this.now() + ttlMs);
  }

  purgeExpired(): void {
    this.db.prepare('DELETE FROM tmdb_cache WHERE expires_at <= ?').run(this.now());
  }
}
