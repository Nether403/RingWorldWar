import { defineConfig } from 'vitest/config';
import { alias } from './vite.config';

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
