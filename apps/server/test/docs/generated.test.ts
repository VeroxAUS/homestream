import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../src/db/index.js';
import { MIGRATIONS } from '../../src/db/migrations.js';
import {
  DATABASE_DOC,
  SCHEMA_FILE,
  renderSchema,
  renderSchemaFromMigrations,
  tablesIn,
  undocumentedTables,
} from '../../src/docs/generated.js';

const lf = (text: string): string => text.replace(/\r\n/g, '\n');

describe('renderSchema', () => {
  it('dumps every table and index with the migration version', () => {
    const sql = renderSchemaFromMigrations();
    expect(sql).toContain(`-- user_version: ${MIGRATIONS.at(-1)?.version}`);
    expect(tablesIn(sql)).toEqual(
      expect.arrayContaining([
        'progress',
        'plays',
        'devices',
        'events',
        'tmdb_cache',
        'gateway_cache',
        'pending_downloads',
      ]),
    );
    expect(sql).toContain('CREATE INDEX idx_plays_started');
    expect(sql).not.toContain('sqlite_sequence');
  });

  it('is deterministic and removes the migration indentation', () => {
    const first = renderSchemaFromMigrations();
    expect(renderSchemaFromMigrations()).toBe(first);
    expect(first).not.toMatch(/^ {6}/m);
  });

  it('matches the committed docs/schema.sql', () => {
    expect(lf(readFileSync(SCHEMA_FILE, 'utf8'))).toBe(renderSchemaFromMigrations());
  });

  it('changes when a migration adds a column, so the drift check fails until it is regenerated', () => {
    const db = openDatabase(':memory:');
    migrate(db, [...MIGRATIONS, { version: 99, sql: 'ALTER TABLE devices ADD COLUMN note TEXT;' }]);
    const changed = renderSchema(db);
    db.close();
    expect(changed).toContain('note TEXT');
    expect(changed).not.toBe(lf(readFileSync(SCHEMA_FILE, 'utf8')));
  });
});

describe('docs/database.md', () => {
  it('has a section for every table in the schema', () => {
    const doc = readFileSync(DATABASE_DOC, 'utf8');
    expect(undocumentedTables(renderSchemaFromMigrations(), doc)).toEqual([]);
  });

  it('reports tables without a section', () => {
    const sql = 'CREATE TABLE alpha (id INTEGER);\n\nCREATE TABLE "beta" (id INTEGER);\n';
    expect(undocumentedTables(sql, '### `alpha`\n')).toEqual(['beta']);
  });
});
