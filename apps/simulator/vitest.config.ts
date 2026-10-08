import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@perspice/shared': resolve(__dirname, '../../packages/shared/src/index.ts') } },
  test: { name: 'simulator', include: ['test/**/*.test.ts'] },
});
