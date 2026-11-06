import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { recordConfigWarnings } from '../src/events/configWarnings.js';
import { makeTempDir, removeDir, startTestApp } from './helpers.js';

describe('recordConfigWarnings', () => {
  let root: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    root = makeTempDir('config-warnings');
    app = await startTestApp(root, { MAX_DOWNLOAD_MBPS: 'abc', READ_AHEAD_SEC: '180', READ_AHEAD_RESUME_SEC: '200' });
  });
  afterAll(async () => {
    await app.close();
    removeDir(root);
  });

  it('keeps each invalid-setting warning as a warn event that names the key, and pushes it to subscribers', () => {
    const seen: unknown[] = [];
    const off = app.ctx.bus.subscribe((event) => {
      if (event.type === 'log') seen.push(event.data);
    });
    expect(app.ctx.config.warnings).toHaveLength(2);
    recordConfigWarnings({ db: app.ctx.db, bus: app.ctx.bus }, app.ctx.config.warnings);
    off();

    const rows = app.ctx.db.prepare("SELECT level, source, message FROM events WHERE level = 'warn' ORDER BY id").all() as Array<{
      level: string;
      source: string;
      message: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.source)).toEqual(['server', 'server']);
    expect(rows[0]?.message).toContain('MAX_DOWNLOAD_MBPS');
    expect(rows[0]?.message).toContain('default 150');
    expect(rows[1]?.message).toContain('READ_AHEAD_RESUME_SEC');
    expect(seen).toHaveLength(2);
  });

  it('records nothing when there is nothing to warn about', () => {
    const before = (app.ctx.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
    recordConfigWarnings({ db: app.ctx.db, bus: app.ctx.bus }, []);
    expect((app.ctx.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n).toBe(before);
  });
});
