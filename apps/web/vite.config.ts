import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { visualizer } from 'rollup-plugin-visualizer';
import { loadEnv, type PluginOption } from 'vite';
import { defineConfig } from 'vitest/config';
import { baseTestConfig, ciTestConfig, coverageReporters, sharedSrcAlias } from '../../vitest.shared.js';
import coverageThresholds from './coverage-thresholds.json' with { type: 'json' };
import pkg from './package.json' with { type: 'json' };
import { nonEmpty, telemetryFromEnv, type BuildEnv } from './src/telemetry/buildEnv.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** The process environment wins over `.env`, like everywhere else in the repository. */
function readEnv(mode: string): BuildEnv {
  return { ...loadEnv(mode, repoRoot, ''), ...process.env };
}

export default defineConfig(({ mode }) => {
  const env = readEnv(mode);
  const telemetry = telemetryFromEnv(env, mode, pkg.version);
  // Source maps are produced only when they will be uploaded to Sentry and deleted from dist right after, so a build
  // never ships them: release builds (HOMESTREAM_RELEASE_BUILD=1) with an organization token.
  const uploadSourceMaps = env.HOMESTREAM_RELEASE_BUILD === '1' && !!nonEmpty(env.SENTRY_AUTH_TOKEN) && !telemetry.off;
  const plugins: PluginOption[] = [react()];
  if (uploadSourceMaps) {
    plugins.push(
      sentryVitePlugin({
        org: nonEmpty(env.SENTRY_ORG) ?? undefined,
        project: 'homestream-web',
        authToken: nonEmpty(env.SENTRY_AUTH_TOKEN) ?? undefined,
        release: { name: telemetry.release },
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        telemetry: false,
      }),
    );
  }
  if (mode === 'analyze') {
    plugins.push(
      visualizer({ filename: 'reports/bundle.html', template: 'treemap', gzipSize: true, brotliSize: true }),
    );
  }

  return {
    plugins,
    define: { HS_TELEMETRY: JSON.stringify(telemetry) },
    resolve: { alias: sharedSrcAlias },
    server: {
      port: 8601,
      proxy: {
        '/api': 'http://127.0.0.1:8600',
        '/hls': 'http://127.0.0.1:8600',
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: uploadSourceMaps ? 'hidden' : false,
      rolldownOptions: {
        output: {
          // The telemetry chunk gets a stable name so the bundle budget (.size-limit.json) can address it.
          chunkFileNames: (chunk) =>
            chunk.facadeModuleId?.includes('/src/telemetry/runtime')
              ? 'assets/telemetry-[hash].js'
              : 'assets/[name]-[hash].js',
        },
      },
    },
    test: {
      ...baseTestConfig,
      ...ciTestConfig('web'),
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.d.ts'],
        reporter: coverageReporters,
        reportsDirectory: 'coverage',
        thresholds: coverageThresholds,
      },
    },
  };
});
