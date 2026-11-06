import { defineConfig } from 'vitest/config';
import { baseTestConfig, ciTestConfig, coverageReporters } from '../../vitest.shared.js';
import coverageThresholds from './coverage-thresholds.json' with { type: 'json' };

export default defineConfig({
  test: {
    ...baseTestConfig,
    ...ciTestConfig('shared'),
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
