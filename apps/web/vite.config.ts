import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export const alias = {
  '@': resolve(__dirname, 'src'),
  '@perspice/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
  '@perspice/widgets': resolve(__dirname, '../../packages/widgets/src/index.ts'),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', ws: true, changeOrigin: false },
    },
  },
  // The app chunk is ~640 kB (≈200 kB gzipped); ECharts is split into the History tab chunk.
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 800 },
});
