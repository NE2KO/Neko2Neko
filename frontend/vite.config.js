import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const certPath = fileURLToPath(new URL('./certs/localhost.pem', import.meta.url));
const keyPath = fileURLToPath(new URL('./certs/localhost-key.pem', import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    https: {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    },
    proxy: {
      '/api': { target: 'https://127.0.0.1:3001', secure: false, changeOrigin: true },
      '/stream': { target: 'https://127.0.0.1:3001', secure: false, changeOrigin: true },
      '/file': { target: 'https://127.0.0.1:3001', secure: false, changeOrigin: true },
      '/thumbnails': { target: 'https://127.0.0.1:3001', secure: false, changeOrigin: true },
      '/ws': {
        target: 'wss://127.0.0.1:3001',
        ws: true,
        secure: false,
        changeOrigin: true,
      },
      '/api/audio': {
        target: 'https://127.0.0.1:3001',
        secure: false,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/audio/, '/stream/audio')
      },
    },
  },
  build: {
    outDir: 'dist',
    // Emit .map files so the crash screen can rewrite the minified
    // prod stack (index-*.js) back to the original File.jsx:LINE.
    sourcemap: true,
  },
});
