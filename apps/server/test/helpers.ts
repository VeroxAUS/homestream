import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, type BuildAppOptions } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createSilentLogger } from '../src/logger.js';

const TEST_ROOT = 'D:\\HomeStream\\test-tmp';

const DEFAULT_ENV_FILE =
  'GATEWAY_MANIFEST_URL=https://gw.example.test/stremio/aaaa1111/bbbb2222cccc/manifest.json\nTMDB_READ_TOKEN=tmdb-test-token-123456\n';

export function makeTempDir(prefix = 'server'): string {
  mkdirSync(TEST_ROOT, { recursive: true });
  return mkdtempSync(path.join(TEST_ROOT, `${prefix}-`));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export function makeWebDir(root: string): string {
  const webDir = path.join(root, 'web');
  mkdirSync(path.join(webDir, 'assets'), { recursive: true });
  writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>');
  writeFileSync(path.join(webDir, 'assets', 'app.js'), 'console.log("app")');
  return webDir;
}

export function testConfig(root: string, overrides: Record<string, string> = {}, fileContent = DEFAULT_ENV_FILE): Config {
  const envFile = path.join(root, 'test.env');
  writeFileSync(envFile, fileContent);
  return loadConfig({
    env: {
      HOMESTREAM_ENV_FILE: envFile,
      DATA_DIR: path.join(root, 'data'),
      TRANSCODE_DIR: path.join(root, 'transcode'),
      PORT: '0',
      ...overrides,
    },
    repoRoot: null,
  });
}

export async function startTestApp(
  root: string,
  overrides: Record<string, string> = {},
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const config = testConfig(root, overrides);
  return buildApp(config, { logger: createSilentLogger(), ...options });
}
