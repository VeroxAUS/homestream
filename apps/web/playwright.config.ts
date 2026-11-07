import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig } from '@playwright/test';
import ports from './e2e/ports.json' with { type: 'json' };

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const serverEntry = path.join(webRoot, '..', 'server', 'dist', 'index.js');
const runRoot = path.join(webRoot, 'reports', 'e2e-run');
const ci = !!process.env.CI;

function serverEnv(name: 'plain' | 'stub', port: number): Record<string, string> {
  const root = path.join(runRoot, name);
  mkdirSync(root, { recursive: true });
  return {
    PORT: String(port),
    // An env file that does not exist: the developer's .env or %APPDATA% config can never be picked up.
    HOMESTREAM_ENV_FILE: path.join(root, 'none.env'),
    HOMESTREAM_WEB_DIR: path.join(webRoot, 'reports', 'e2e-dist', name),
    DATA_DIR: path.join(root, 'data'),
    TRANSCODE_DIR: path.join(root, 'transcode'),
    GATEWAY_MANIFEST_URL: `http://127.0.0.1:${ports.gateway}/stub/manifest.json`,
    TMDB_READ_TOKEN: 'e2e-not-a-real-token',
    E2E_TMDB_ORIGIN: `http://127.0.0.1:${ports.tmdb}`,
    NODE_OPTIONS: `--import ${pathToFileURL(path.join(webRoot, 'e2e', 'support', 'redirect-fetch.mjs')).href}`,
    // The server under test sends no telemetry of its own; the web telemetry is what the e2e suite looks at.
    HOMESTREAM_TELEMETRY: 'off',
    HOMESTREAM_MDNS: 'off',
    SOURCE_PROXY_PORT: '0',
    MAX_DOWNLOAD_MBPS: '60',
    LOG_LEVEL: 'warn',
  };
}

function server(name: 'plain' | 'stub', port: number) {
  return {
    command: `node "${serverEntry}"`,
    url: `http://127.0.0.1:${port}/api/info`,
    env: serverEnv(name, port),
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe' as const,
    stderr: 'pipe' as const,
  };
}

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'reports/e2e-results',
  fullyParallel: false,
  workers: 1,
  retries: ci ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  forbidOnly: ci,
  reporter: ci
    ? [['github'], ['html', { open: 'never', outputFolder: 'reports/e2e-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'reports/e2e-report' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'plain',
      testMatch: ['smoke.spec.ts', 'resume.spec.ts', 'player-input.spec.ts'],
      use: { baseURL: `http://127.0.0.1:${ports.serverPlain}` },
    },
    { name: 'telemetry', testMatch: 'telemetry.spec.ts', use: { baseURL: `http://127.0.0.1:${ports.serverStub}` } },
  ],
  webServer: [
    {
      command: 'node e2e/support/hub.mjs',
      url: `http://127.0.0.1:${ports.sentry}/__health`,
      reuseExistingServer: false,
      timeout: 30_000,
      cwd: webRoot,
    },
    server('plain', ports.serverPlain),
    server('stub', ports.serverStub),
  ],
});
