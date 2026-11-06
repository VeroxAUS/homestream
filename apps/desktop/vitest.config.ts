import { defineConfig } from 'vitest/config';
import { baseTestConfig, ciTestConfig, coverageReporters, sharedSrcAlias } from '../../vitest.shared.js';
import coverageThresholds from './coverage-thresholds.json' with { type: 'json' };

// Unit tests sit in test/, tests of several modules working together (supervisor, telemetry wiring) in test/integration/.
// Neither starts Electron: main-process logic takes its Electron and network dependencies as arguments.
export default defineConfig({
  resolve: { alias: sharedSrcAlias },
  test: {
    ...baseTestConfig,
    ...ciTestConfig('desktop'),
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: coverageReporters,
      reportsDirectory: 'coverage',
      thresholds: coverageThresholds,
    },
  },
});
