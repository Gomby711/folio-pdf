import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Bypass rollup entirely for the preload — "type":"module" causes rollup to
// convert require() → ESM import, which breaks Electron's sandboxed CJS loader.
// We just copy the hand-written CJS source directly to dist-electron/.
function copyPreload() {
  return {
    name: 'copy-preload-cjs',
    buildStart() {
      mkdirSync('dist-electron', { recursive: true });
      copyFileSync(
        resolve(__dirname, 'electron/preload.cjs'),
        resolve(__dirname, 'dist-electron/preload.cjs'),
      );
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    copyPreload(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(options) { options.startup(); },
      },
    ]),
    renderer(),
  ],
  optimizeDeps: {
    include: ['pdfjs-dist'],
    exclude: ['tesseract.js'],
  },
});
