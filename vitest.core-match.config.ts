import { defineConfig } from 'vitest/config';
import { alias } from './vite.config.ts';

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['validation/core-match.test.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 3_600_000,
  },
});
