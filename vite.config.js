import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves this repo at https://synthica-org.github.io/dashboard/,
// so production builds prefix assets + routes with /dashboard/. Override with
// VITE_BASE=/ when deploying to a custom domain. Dev stays at /.
//
// Build output goes to docs/ — commit it and point GitHub Pages at
// main → /docs (Settings → Pages → Deploy from a branch).
export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  base: command === 'build' || isPreview ? process.env.VITE_BASE || '/dashboard/' : '/',
  build: {
    outDir: 'docs',
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
}));
