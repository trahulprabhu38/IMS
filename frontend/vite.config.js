import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,           // frontend on 3000; backend runs separately on 8000
    proxy: {
      '/api':    { target: 'http://localhost:8000', changeOrigin: true },
      '/health': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': {
        target: 'http://localhost:8000',  // http:// here; Vite handles the WS upgrade itself
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
  