import { defineConfig } from 'vite';

// GitHub Pages serves the game from a subpath, so base must match the repository name.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/kalpa/',
  build: { target: 'es2020', assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 },
});
