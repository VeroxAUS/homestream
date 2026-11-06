import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { baseTestConfig, ciTestConfig, coverageReporters, sharedSrcAlias } from '../../vitest.shared.js';
import coverageThresholds from './coverage-thresholds.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  resolve: { alias: sharedSrcAlias },
  server: {
    port: 8601,
    proxy: {
      '/api': 'http://127.0.0.1:8600',
      '/hls': 'http://127.0.0.1:8600',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    ...baseTestConfig,
    ...ciTestConfig('web'),
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}'],
      reporter: coverageReporters,
      reportsDirectory: 'coverage',
      thresholds: coverageThresholds,
    },
  },
});
