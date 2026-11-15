import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base: the same build runs at the domain root (dev, preview) and
  // under a sub-path such as GitHub Pages' /<repo>/, with no path to keep in sync.
  base: './',
});
