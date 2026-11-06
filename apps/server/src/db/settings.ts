import { randomUUID } from 'node:crypto';
import type { Db } from './index.js';

const INSTALL_ID_KEY = 'install_id';

export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(key, value, Date.now());
}

/** Random id of this installation for anonymous analytics; not derived from the host, user or network. */
export function installId(db: Db): string {
  const existing = getSetting(db, INSTALL_ID_KEY);
  if (existing) return existing;
  const created = randomUUID();
  setSetting(db, INSTALL_ID_KEY, created);
  return created;
}
