import { defineConfig } from 'vite';

// GitHub Pages serves this repo at /Claude-Code-Game/ (see DECISIONS #3).
// Used for dev, build and preview alike so URLs behave the same everywhere.
export default defineConfig({
  base: '/Claude-Code-Game/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
  },
});
