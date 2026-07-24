import { defineConfig } from 'vitest/config';

// Test config is kept separate from vite.config.ts so Vitest's bundled Vite
// version never conflicts with the app's build plugins. The unit tests cover
// framework-free utilities and the reducer, so no React plugin is needed here.
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
