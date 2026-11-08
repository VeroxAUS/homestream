import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const dbFile = path.join(
  fileURLToPath(new URL('../..', import.meta.url)),
  'reports',
  'e2e-run',
  'plain',
  'data',
  'homestream.db',
);

/**
 * The plain e2e server owns this database; a test writes the rows a played session would have left behind. Existing
 * progress and plays are cleared first, so every test starts from exactly the rows it asks for.
 */
export function seed(rows: (db: DatabaseSync) => void): void {
  mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('DELETE FROM progress; DELETE FROM plays;');
    rows(db);
  } finally {
    db.close();
  }
}
