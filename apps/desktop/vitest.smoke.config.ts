import { defineConfig } from 'vitest/config';

// The Electron launch smoke test: starts the real app, so it never runs with the unit tests (`pnpm smoke`).
export default defineConfig({
  test: {
    include: ['test/smoke/*.smoke.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 150_000,
  },
});
