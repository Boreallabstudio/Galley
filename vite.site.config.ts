import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// The showcase page: the skin from src/ on a plain page, with the demonstration media from apps/preview/public.
export default defineConfig({
  root: path('./site'),
  base: './',
  envDir: path('.'),
  publicDir: path('./apps/preview/public'),
  resolve: { alias: { '@': path('./src') } },
  server: { fs: { allow: [path('.')] } },
  build: { outDir: path('./dist-site'), emptyOutDir: true },
});
