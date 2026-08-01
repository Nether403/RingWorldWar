import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const alias = {
  '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
  '@sim': fileURLToPath(new URL('./src/sim', import.meta.url)),
  '@render': fileURLToPath(new URL('./src/render', import.meta.url)),
  '@gen': fileURLToPath(new URL('./src/gen', import.meta.url)),
  '@ai': fileURLToPath(new URL('./src/ai', import.meta.url)),
  '@headless': fileURLToPath(new URL('./src/headless', import.meta.url)),
  '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
};

export { alias };

export default defineConfig({
  resolve: { alias },
  server: { port: 5180, open: false },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
