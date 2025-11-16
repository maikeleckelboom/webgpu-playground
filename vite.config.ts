import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    host: true,
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
  preview: {
    port: 3000,
    open: true,
    host: true,
  },
  optimizeDeps: {
    exclude: ['@webgpu/types'],
  },
  assetsInclude: ['**/*.wgsl'],
});
