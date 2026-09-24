import { defineConfig } from 'vitest/config';

// `base: './'` keeps every asset path relative, so the build works from any
// sub-folder (CrazyGames serves uploads from its own CDN path).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
