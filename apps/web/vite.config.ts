import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { type Plugin, defineConfig } from 'vite';

export const alias = {
  '@': resolve(__dirname, 'src'),
  '@perspice/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
  '@perspice/widgets': resolve(__dirname, '../../packages/widgets/src/index.ts'),
};

/**
 * Demo mode (`vite --mode demo`): the API is mocked in the browser by MSW with the fixtures in
 * src/demo, and the realtime socket by a stand-in that pushes readings. No server needed.
 */
const demo = (): Plugin => ({
  name: 'perspice-demo',
  configureServer(server) {
    // MSW's service worker, served from the package so it never lands in a production build.
    const worker = readFileSync(createRequire(import.meta.url).resolve('msw/mockServiceWorker.js'), 'utf8');
    server.middlewares.use('/mockServiceWorker.js', (_req, res) => {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(worker);
    });
  },
});

export default defineConfig(({ mode }) => ({
  plugins: mode === 'demo' ? [react(), demo()] : [react()],
  resolve: {
    alias: mode === 'demo' ? [{ find: '@/realtime/socket', replacement: resolve(__dirname, 'src/demo/socket.ts') }, ...Object.entries(alias).map(([find, replacement]) => ({ find, replacement }))] : alias,
  },
  define: { 'import.meta.env.DEMO': JSON.stringify(mode === 'demo') },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', ws: true, changeOrigin: false },
    },
  },
  // The app chunk is ~640 kB (≈200 kB gzipped); ECharts is split into the History tab chunk.
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 800 },
}));
