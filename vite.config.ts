import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 10000000 },
  worker: { format: 'iife', rollupOptions: { output: { inlineDynamicImports: true } } },
});
