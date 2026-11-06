import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.stubEnv('DEV', false);
  window.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
