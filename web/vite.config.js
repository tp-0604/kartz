import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two ways to host the same build.
//
//   GitHub Pages   https://tp-0604.github.io/kartz/   base '/kartz/', API on the Worker's URL
//   The Worker     https://kartz.<subdomain>.workers.dev  base '/', API is same-origin at /api
//
// BASE_PATH picks between them at build time; VITE_API_BASE (in .env.production or the
// environment) says where /api lives. Neither is needed for `npm run dev`, which proxies /api
// to `wrangler dev` on 8787 so the page and the Worker share an origin exactly as they do
// when the Worker serves the site itself.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || '/kartz/',
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 6000,
    // The workbook is by far the largest thing here and it is only needed on the Sheet tab.
    // SheetScreen is React.lazy, so Vite already puts Univer in a chunk of its own — and its
    // hyphenation dictionaries in lazy chunks of their own, which forcing one manual chunk undid.
  },
});
