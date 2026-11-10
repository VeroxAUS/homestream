// Builds the web UI twice for the end-to-end tests, into reports/e2e-dist:
//   plain  holds no telemetry key at all (what a build without SENTRY_DSN_WEB / POSTHOG_* contains)
//   stub   points Sentry and PostHog at the local receivers of the stub hub and enables the telemetry test trigger
// The developer's .env never leaks in: every telemetry variable is set explicitly for both builds.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ports from './ports.json' with { type: 'json' };

const webRoot = fileURLToPath(new URL('..', import.meta.url));
// The Playwright config itself must stay loadable without a built server (knip imports it).
if (!existsSync(fileURLToPath(new URL('../../server/dist/index.js', import.meta.url)))) {
  console.error('Build the server first: pnpm --filter @homestream/server build');
  process.exit(1);
}
// The e2e servers keep their database (and its 10-minute TMDB answer cache) here; a run must not inherit the last one.
rmSync(fileURLToPath(new URL('../reports/e2e-run', import.meta.url)), { recursive: true, force: true });
const NO_TELEMETRY = {
  SENTRY_DSN_WEB: '',
  POSTHOG_API_KEY: '',
  POSTHOG_HOST: '',
  HOMESTREAM_TELEMETRY: '',
  HOMESTREAM_TELEMETRY_STUB: '',
  HOMESTREAM_RELEASE_BUILD: '',
  SENTRY_AUTH_TOKEN: '',
  SENTRY_RELEASE: '',
  SENTRY_ENVIRONMENT: '',
};

const builds = {
  plain: NO_TELEMETRY,
  stub: {
    ...NO_TELEMETRY,
    SENTRY_DSN_WEB: `http://e2epublickey@127.0.0.1:${ports.sentry}/1`,
    POSTHOG_API_KEY: 'phc_e2e_stub_key',
    POSTHOG_HOST: `http://127.0.0.1:${ports.posthog}`,
    HOMESTREAM_TELEMETRY_STUB: '1',
    SENTRY_ENVIRONMENT: 'e2e',
  },
};

const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

for (const [name, env] of Object.entries(builds)) {
  const run = spawnSync(process.execPath, [viteBin, 'build', '--outDir', `reports/e2e-dist/${name}`], {
    cwd: webRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
