import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildNetworkCheck } from '../../src/network/check.js';
import { networkSnapshot } from '../../src/network/snapshot.js';
import { makeTempDir, removeDir, startTestApp } from '../helpers.js';

const apps: Array<{ app: FastifyInstance; root: string }> = [];

afterEach(async () => {
  for (const { app, root } of apps.splice(0)) {
    await app.close();
    removeDir(root);
  }
});

async function boot(env: Record<string, string>): Promise<FastifyInstance> {
  const root = makeTempDir('network');
  const app = await startTestApp(root, env);
  apps.push({ app, root });
  return app;
}

describe('networkSnapshot on a real app', () => {
  it('shows the configured cap and window, idle and without sessions', async () => {
    const app = await boot({ MAX_DOWNLOAD_MBPS: '45', READ_AHEAD_SEC: '240', READ_AHEAD_RESUME_SEC: '150' });
    const snapshot = networkSnapshot(app.ctx);
    expect(snapshot).toEqual({
      rateMbps: 0,
      capMbps: 45,
      readAheadSec: 240,
      resumeSec: 150,
      limitedForSec: 0,
      sessions: [],
    });
    const check = buildNetworkCheck(snapshot, { nowMs: Date.now() });
    expect(check).toMatchObject({ id: 'network', status: 'ok', message: 'Downloading 0.0 of 45 Mbps.' });
  });

  it('falls back to 150 / 180 / 120 for invalid values and keeps running', async () => {
    const app = await boot({ MAX_DOWNLOAD_MBPS: '2', READ_AHEAD_SEC: '180', READ_AHEAD_RESUME_SEC: '200' });
    expect(networkSnapshot(app.ctx)).toMatchObject({ capMbps: 150, readAheadSec: 180, resumeSec: 120 });
  });

  it('contains nothing that could identify a source', async () => {
    const app = await boot({ MAX_DOWNLOAD_MBPS: '60' });
    const text = JSON.stringify(buildNetworkCheck(networkSnapshot(app.ctx), { nowMs: Date.now() }));
    expect(text).not.toMatch(/https?:|127\.0\.0\.1|\/src\//);
  });

  it('reports no sessions and nothing falling behind when none is running', async () => {
    const app = await boot({});
    expect(app.ctx.playback.networkSessions()).toEqual([]);
    expect(app.ctx.playback.fallingBehindSessions()).toEqual([]);
  });
});
