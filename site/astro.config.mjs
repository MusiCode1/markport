// @ts-check
import { defineConfig } from 'astro/config';

// The site is static and ships no client JavaScript. Shiki highlights the
// code samples at build time, which is what the hand-rolled tokeniser this
// replaced used to do.
export default defineConfig({
  site: 'https://markport.pages.dev',
  outDir: '../.tmp/site',
  build: { format: 'directory' },
  markdown: {
    shikiConfig: {
      theme: 'github-dark-default',
      wrap: false,
    },
  },
});
