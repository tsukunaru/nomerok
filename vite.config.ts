import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    legacy({
      targets: [
        'Chrome >= 49',
        'Firefox >= 45',
        'Safari >= 9',
        'iOS >= 9',
        'Edge >= 12',
        'Android >= 5',
      ],
      modernPolyfills: true,
    }),
  ],
  build: {
    sourcemap: false,
  },
});
