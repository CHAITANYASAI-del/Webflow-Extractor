import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds the CMS admin into ../../../../../../../Users/chey/Downloads/Webflow Extractor/admin-dist — the extension
// copies it into every export as /admin (plus the preview worker at the root).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../admin-dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    assetsInlineLimit: 40000, // inline the logo so the admin stays 3 files
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true, entryFileNames: 'assets/admin.js', assetFileNames: 'assets/admin[extname]' } },
  },
});
