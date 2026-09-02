import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: false,
  server: {
    allowedHosts: ['o2kclouddrive.duckdns.org']
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
