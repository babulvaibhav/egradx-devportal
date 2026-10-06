import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The application's API and the SDK's endpoints, on the same origin as the page in development. In production, a
// reverse proxy does the same (and must not buffer /egradx/notifications/stream, the live stream).
const backend = process.env.VITE_PROXY_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/egradx': { target: backend, changeOrigin: true },
    },
  },
});
