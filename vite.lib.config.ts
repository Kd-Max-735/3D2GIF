import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    emptyOutDir: false,
    lib: { entry: resolve(import.meta.dirname, 'src/index.ts'), formats: ['es'], fileName: () => 'orbitframe.js' },
    rollupOptions: { external: [/^three(?:\/.*)?$/] }
  }
});
