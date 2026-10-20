import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// The app lives in app/ so the dev server can't serve files from the repo root
// (secrets.json and media-archive-data.json sit there).
export default defineConfig({
  root: 'app',
  base: './',
  plugins: [vue()],
  server: {
    // A fixed port keeps one origin, so the browser remembers the connected folder
    // and any pasted key between runs.
    port: 5173,
    strictPort: true,
    // Serve only the app and its packages; never the keys or the data file.
    fs: {
      allow: [here('./app'), here('./node_modules')],
      deny: ['secrets.json', 'media-archive-data*.json', '.env', '.env.*'],
    },
  },
  build: { outDir: '../dist', emptyOutDir: true },
  test: {
    root: '.',
    environment: 'jsdom',
    include: ['app/src/**/*.test.js'],
    // The first test after a cold transform can pass 5s, mostly when `npm run dev` runs alongside.
    testTimeout: 15000,
  },
});
