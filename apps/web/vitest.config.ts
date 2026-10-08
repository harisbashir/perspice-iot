import react from '@vitejs/plugin-react';
import { type ViteUserConfig, defineConfig } from 'vitest/config';
import { alias } from './vite.config';

type VitestPlugin = NonNullable<ViteUserConfig['plugins']>[number];

export default defineConfig({
  // Vitest bundles its own Vite major; the React plugin's types target the app's Vite 6.
  plugins: [react() as unknown as VitestPlugin],
  resolve: { alias },
  test: {
    name: 'web',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
