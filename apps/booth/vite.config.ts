import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..');
  const API = process.env.VITE_API_PROXY ?? env.VITE_API_PROXY ?? 'http://localhost:8080';
  const ROBOT = process.env.VITE_ROBOT_PROXY ?? env.VITE_ROBOT_PROXY ?? 'http://127.0.0.1:5001';
  const proxy = {
    '/api': { target: API, changeOrigin: false },
    '/storage': { target: API, changeOrigin: false },
    '/health': { target: API, changeOrigin: false },
    '/jona': { target: ROBOT, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/jona/, '') },
  };

  return {
    envDir: '../..',
    plugins: [react()],
    // Booth hanya dibuka di mesin kiosk. Jangan buka ke LAN: proxy /jona di atas
    // meneruskan perintah robot tanpa login.
    server: { port: 5173, strictPort: true, host: '127.0.0.1', proxy },
    preview: { port: 5173, strictPort: true, host: '127.0.0.1', proxy },
    build: { outDir: 'dist', sourcemap: false, target: 'es2020', chunkSizeWarningLimit: 1200 },
  };
});
