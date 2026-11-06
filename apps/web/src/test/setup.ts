import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.stubEnv('DEV', false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
