import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:8080';
/** jona-bridge (scripts/jona-bridge.ts): Robot page jogs the arm and edits poses through it. */
const ROBOT = process.env.VITE_ROBOT_PROXY ?? 'http://localhost:5001';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: API },
      '/media': { target: API },
      '/storage': { target: API },
      '/g/': { target: API },
      '/jona': { target: ROBOT, changeOrigin: true, rewrite: (p) => p.replace(/^\/jona/, '') },
    },
  },
  build: { outDir: 'dist', sourcemap: false, target: 'es2020' },
});
