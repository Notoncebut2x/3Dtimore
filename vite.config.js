import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': {},
  },
  optimizeDeps: {
    include: ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/react', 'maplibre-gl'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'deck-gl': ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/react'],
          'maplibre': ['maplibre-gl', 'react-map-gl'],
        },
      },
    },
  },
});
