import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    // Forward backend calls in dev so the app can use same-origin URLs
    proxy: {
      '/api':    'http://localhost:8765',
      '/health': 'http://localhost:8765',
      '/ws':     { target: 'ws://localhost:8765', ws: true },
    },
  },
  build: { outDir: 'dist' }
})
