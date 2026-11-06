import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/index.js';
import { createSilentLogger } from '../logger.js';

/**
 * Builds the app against an in-memory database and a throwaway directory, with no config file and no network use,
 * and hands it to `use`. The export scripts run this way so they work in a fresh clone without `.env`.
 */
export async function withDocsApp<T>(use: (app: FastifyInstance) => Promise<T>): Promise<T> {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'homestream-docs-'));
  const config = loadConfig({
    env: { DATA_DIR: scratch, TRANSCODE_DIR: path.join(scratch, 'transcode'), PORT: '0', HOMESTREAM_ENV_FILE: '' },
    repoRoot: null,
  });
  const db = openDatabase(':memory:');
  const app = await buildApp(config, { logger: createSilentLogger(), db });
  try {
    await app.ready();
    return await use(app);
  } finally {
    await app.close();
    db.close();
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
