import { configDefaults, defineConfig } from 'vitest/config';
import { baseTestConfig, ciTestConfig, coverageReporters, sharedSrcAlias } from '../../vitest.shared.js';
import coverageThresholds from './coverage-thresholds.json' with { type: 'json' };
import { GPU_HOOK_TIMEOUT_MS, GPU_TEST_GLOBS, GPU_TEST_TIMEOUT_MS } from './test/gpuGroups.js';

// Four tiers, each a vitest project (`vitest run --project <name>`):
//   unit         pure logic, fast, parallel; no network, GPU or secrets
//   integration  Fastify inject and the stub gateway with fake encoders; no network, GPU or secrets
//   gpu          every test that starts ffmpeg; one file at a time so 4K NVENC/NVDEC jobs never overlap
//   live         real TMDB/gateway lookups; skipped when the keys are missing
// `test:ci` runs unit + integration. Plain `vitest run` runs everything.
const LIVE_GLOBS = ['test/live/**/*.test.ts'];
const INTEGRATION_GLOBS = ['test/integration/**/*.test.ts'];

export default defineConfig({
  resolve: { alias: sharedSrcAlias },
  test: {
    ...baseTestConfig,
    ...ciTestConfig('server'),
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: coverageReporters,
      reportsDirectory: 'coverage',
      thresholds: coverageThresholds,
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...GPU_TEST_GLOBS, ...INTEGRATION_GLOBS, ...LIVE_GLOBS],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: INTEGRATION_GLOBS,
        },
      },
      {
        extends: true,
        test: {
          name: 'gpu',
          include: GPU_TEST_GLOBS,
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: GPU_TEST_TIMEOUT_MS,
          hookTimeout: GPU_HOOK_TIMEOUT_MS,
          setupFiles: ['test/gpuSetup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'live',
          include: LIVE_GLOBS,
        },
      },
    ],
  },
});
