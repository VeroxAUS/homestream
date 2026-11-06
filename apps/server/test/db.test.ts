import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../src/db/index.js';
import { upsertDevice } from '../src/db/devices.js';
import { makeTempDir, removeDir } from './helpers.js';

let root: string;
beforeAll(() => {
  root = makeTempDir('db');
});
afterAll(() => removeDir(root));

const profile = {
  deviceId: 'd1',
  deviceName: 'Device One',
  kind: 'web' as const,
  maxWidth: 1920,
  maxHeight: 1080,
  h264: true,
  hevc: false,
  hevcMain10: false,
  hdr10: false,
  maxAudioChannels: 2,
};

describe('database', () => {
  it('creates every table from the architecture', () => {
    const db = openDatabase(':memory:');
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
      (row) => row.name,
    );
    for (const name of ['progress', 'plays', 'devices', 'events', 'tmdb_cache', 'gateway_cache']) {
      expect(tables).toContain(name);
    }
    db.close();
  });

  it('creates the documented columns', () => {
    const db = openDatabase(':memory:');
    const columns = (table: string): string[] =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    expect(columns('progress')).toEqual(
      expect.arrayContaining([
        'media_key',
        'tmdb_id',
        'type',
        'season',
        'episode',
        'position_sec',
        'duration_sec',
        'updated_at',
        'completed',
        'meta_json',
      ]),
    );
    expect(columns('plays')).toEqual(
      expect.arrayContaining([
        'id',
        'session_id',
        'media_key',
        'device_id',
        'client_ip',
        'started_at',
        'ended_at',
        'watched_sec',
        'last_position_sec',
        'duration_sec',
        'completed',
        'stream_filename',
        'decision_json',
        'avg_bitrate_kbps',
        'avg_speed',
        'bytes_served',
        'status',
        'error_message',
      ]),
    );
    expect(columns('devices')).toEqual(['id', 'name', 'kind', 'capabilities', 'last_ip', 'last_seen']);
    expect(columns('events')).toEqual(['id', 'ts', 'level', 'source', 'message', 'details_json', 'session_id']);
    expect(columns('tmdb_cache')).toEqual(['key', 'json', 'expires_at']);
    expect(columns('gateway_cache')).toEqual(['key', 'json', 'expires_at']);
    db.close();
  });

  it('migrates idempotently and persists on disk', () => {
    const db = openDatabase(root);
    upsertDevice(db, profile, '192.0.2.5');
    migrate(db);
    db.close();

    const reopened = openDatabase(root);
    const rows = reopened.prepare('SELECT id, last_ip FROM devices').all() as { id: string; last_ip: string }[];
    expect(rows).toEqual([{ id: 'd1', last_ip: '192.0.2.5' }]);
    reopened.close();
  });

  it('accepts prefetch events and keeps the other event sources working', () => {
    const db = openDatabase(':memory:');
    db.prepare("INSERT INTO events (ts, level, source, message) VALUES (1, 'info', 'prefetch', 'x')").run();
    db.prepare("INSERT INTO events (ts, level, source, message) VALUES (2, 'info', 'server', 'y')").run();
    expect((db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n).toBe(2);
    db.close();
  });

  it('accepts download events and keeps one pending download per title', () => {
    const db = openDatabase(':memory:');
    db.prepare("INSERT INTO events (ts, level, source, message) VALUES (1, 'info', 'downloads', 'x')").run();
    const columns = (db.prepare('PRAGMA table_info(pending_downloads)').all() as { name: string }[]).map((c) => c.name);
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'media_key',
        'query_key',
        'info_hash',
        'status',
        'progress',
        'created_at',
        'next_poll_at',
      ]),
    );
    const insert = (id: string, status: string): void => {
      db.prepare(
        `INSERT INTO pending_downloads (id, media_key, media_type, tmdb_id, query_key, title, status, state, created_at, updated_at, next_poll_at, progress_changed_at)
         VALUES (?, 'movie:1', 'movie', 1, 'movie:tt1', 'T', ?, 'pending', 1, 1, 1, 1)`,
      ).run(id, status);
    };
    insert('a', 'pending');
    expect(() => insert('b', 'pending')).toThrow();
    insert('c', 'failed');
    insert('d', 'ready');
    expect((db.prepare('SELECT COUNT(*) AS n FROM pending_downloads').get() as { n: number }).n).toBe(3);
    db.close();
  });

  it('rejects an event with an unknown level', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      db.prepare("INSERT INTO events (ts, level, source, message) VALUES (1, 'fatal', 'server', 'x')").run(),
    ).toThrow();
    db.close();
  });
});

describe('upsertDevice', () => {
  it('updates in place and keeps one row', () => {
    const db = openDatabase(':memory:');
    const first = upsertDevice(db, profile, '192.0.2.5', 1000);
    const second = upsertDevice(db, { ...profile, deviceName: 'Renamed' }, '192.0.2.6', 2000);
    expect(first.lastSeen).toBe(new Date(1000).toISOString());
    expect(second.name).toBe('Renamed');
    expect(second.capabilities.deviceName).toBe('Renamed');
    expect(second.lastSeen).toBe(new Date(2000).toISOString());
    expect(db.prepare('SELECT COUNT(*) AS n FROM devices').get()).toEqual({ n: 1 });
    db.close();
  });
});
