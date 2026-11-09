import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:8080';
/** jona-bridge (scripts/jona-bridge.ts): Robot page jogs the arm and edits poses through it. */
const ROBOT = process.env.VITE_ROBOT_PROXY ?? 'http://127.0.0.1:5001';
/**
 * Where the admin listens. Default: this PC only. To reach it from a tablet without opening it to
 * the venue network, set ADMIN_HOST to this PC's Tailscale address (100.x.y.z): only devices on
 * your tailnet can then connect.
 */
const HOST = process.env.ADMIN_HOST || 'localhost';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    host: HOST,
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: API },
      '/media': { target: API },
      '/storage': { target: API },
      '/g/': { target: API },
      // Only the bridge's admin endpoints (they check the admin token). Its /robot/* has no login
      // and must not be reachable from wherever this page is opened.
      '/jona/admin': { target: ROBOT, changeOrigin: true, rewrite: (p) => p.replace(/^\/jona/, '') },
    },
  },
  build: { outDir: 'dist', sourcemap: false, target: 'es2020' },
});
