import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@perspice/shared': resolve(__dirname, '../shared/src/index.ts') } },
  esbuild: { jsx: 'automatic' },
  test: {
    name: 'widgets',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
