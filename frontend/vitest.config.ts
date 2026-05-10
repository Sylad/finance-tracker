import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Dedicated Vitest config — kept separate from vite.config.ts so the build
// pipeline (tsc -b && vite build) does not pick up test-only fields and so
// devs can run tests with the production-flavored config untouched.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/router.tsx',
        'src/test/**',
        'src/**/*.{test,spec}.{ts,tsx}',
      ],
    },
  },
});
