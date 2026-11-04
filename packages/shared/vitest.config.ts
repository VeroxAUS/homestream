import { defineConfig } from 'vitest/config';
import { baseTestConfig } from '../../vitest.shared.js';

export default defineConfig({
  test: { ...baseTestConfig, include: ['test/**/*.test.ts'] },
});
