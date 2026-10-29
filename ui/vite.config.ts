import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'moss-offline-pdf-assets',
    generateBundle() {
      for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
        const root = path.resolve(__dirname, 'node_modules/pdfjs-dist', directory);
        for (const name of fs.readdirSync(root)) if (fs.statSync(path.join(root, name)).isFile()) this.emitFile({ type: 'asset', fileName: `pdfjs-assets/${directory}/${name}`, source: fs.readFileSync(path.join(root, name)) });
      }
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs-assets', (request, response, next) => {
        const relative = (request.url || '').split('?')[0];
        if (!/^\/(cmaps|standard_fonts|wasm)\/[a-zA-Z0-9_.-]+$/.test(relative)) return next();
        const file = path.resolve(__dirname, 'node_modules/pdfjs-dist', '.' + relative);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        response.end(fs.readFileSync(file));
      });
    },
  }],
  server: {
    host: '127.0.0.1',
    port: parseInt(process.env.VITE_DEV_SERVER_PORT || '5173', 10),
    strictPort: true,
    hmr: {
      host: '127.0.0.1',
      port: parseInt(process.env.VITE_DEV_SERVER_PORT || '5173', 10),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer-react'),
    },
  },
  build: {
    outDir: 'dist/renderer',
    // Open desktop windows still reference the previous build's hashed chunks.
    // Keep them available for lazy imports until those windows are reloaded.
    // A clean release build can explicitly use `vite build --emptyOutDir`.
    emptyOutDir: false,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
      },
      external: [],
    },
  },
});
