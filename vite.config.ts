import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve('src/renderer'), base: './', plugins: [react()],
  build: { outDir: resolve('dist/renderer'), emptyOutDir: true },
});
