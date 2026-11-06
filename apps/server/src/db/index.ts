import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, type Migration } from './migrations.js';

export type Db = DatabaseSync;

const DB_FILE_NAME = 'homestream.db';

export function migrate(db: Db, migrations: Migration[] = MIGRATIONS): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let current = row.user_version;
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (migration.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    current = migration.version;
  }
}

/** Pass ':memory:' as dataDir for an in-memory database. */
export function openDatabase(dataDir: string): Db {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    mkdirSync(dataDir, { recursive: true });
    file = path.join(dataDir, DB_FILE_NAME);
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}
