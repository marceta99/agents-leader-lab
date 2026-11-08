import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev: proxy /api and /ws to the FastAPI backend so the browser sees one origin (same as prod behind Caddy).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
})
