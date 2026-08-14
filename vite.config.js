import { defineConfig } from 'vite';

export default defineConfig({
  root: 'site',
  server: {
    host: '0.0.0.0',
    port: 3000,
    open: true,
  },
});
