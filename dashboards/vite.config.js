import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api to the backend so the dashboards and API share an origin in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
