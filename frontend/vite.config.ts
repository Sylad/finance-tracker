import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Scope `modulepreload` hints so transitive lazy deps (recharts, route
    // chunks) are not eagerly fetched on the HTML entry. Only the tanstack
    // chunk (statically imported by the entry) is preloaded. Without this
    // override, Vite preloads any chunk reachable from the entry's dynamic
    // import map — which would defeat the recharts code-split.
    modulePreload: {
      polyfill: false,
      resolveDependencies: (_filename, deps, { hostType }) =>
        hostType === 'html' ? deps.filter((d) => /tanstack-/.test(d)) : deps,
    },
    rollupOptions: {
      output: {
        manualChunks: {
          // React core stays in the critical path but is split out so it can
          // be cached independently across deploys.
          'react-vendor': ['react', 'react-dom'],
          // TanStack Router/Query are large enough (and cacheable) to live in
          // their own chunk.
          tanstack: ['@tanstack/react-query', '@tanstack/react-router'],
          // Recharts is only used on 4 routes (statement, forecast, yearly,
          // savings). Splitting it out keeps the initial bundle lean.
          recharts: ['recharts'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
