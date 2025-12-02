import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Optimize chunk splitting for Three.js
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
    // Target modern browsers for better performance
    target: 'esnext',
    // Enable minification
    minify: 'esbuild',
  },
  optimizeDeps: {
    // Pre-bundle Three.js for faster dev starts
    include: ['three'],
  },
  server: {
    // HMR for fast development
    hmr: true,
  },
});
