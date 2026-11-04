import { fileURLToPath } from 'node:url';

export const sharedSrcAlias = {
  '@homestream/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
};

export const baseTestConfig = {
  maxWorkers: 8,
  testTimeout: 20_000,
  hookTimeout: 20_000,
};
