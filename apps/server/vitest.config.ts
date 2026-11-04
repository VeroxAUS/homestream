import { defineConfig } from 'vitest/config';
import { baseTestConfig, sharedSrcAlias } from '../../vitest.shared.js';

export default defineConfig({
  resolve: { alias: sharedSrcAlias },
  test: { ...baseTestConfig, include: ['test/**/*.test.ts'] },
});
