import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { baseTestConfig, sharedSrcAlias } from '../../vitest.shared.js';

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
  test: { ...baseTestConfig, include: ['src/**/*.test.{ts,tsx}'] },
});