import { configDefaults, defineConfig } from 'vitest/config';
import { baseTestConfig, sharedSrcAlias } from '../../vitest.shared.js';
import { GPU_HOOK_TIMEOUT_MS, GPU_TEST_GLOBS, GPU_TEST_TIMEOUT_MS } from './test/gpuGroups.js';

// Two projects: pure tests run in parallel; every file that starts ffmpeg runs alone in the `gpu` project
// (vitest schedules it after the unit project, one file at a time) so 4K NVENC/NVDEC jobs never overlap.
export default defineConfig({
  resolve: { alias: sharedSrcAlias },
  test: {
    ...baseTestConfig,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...GPU_TEST_GLOBS],
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
    ],
  },
});
