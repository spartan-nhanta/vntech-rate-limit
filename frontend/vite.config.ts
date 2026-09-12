import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Proxy tránh CORS — tất cả /config, /api, /events → backend localhost:8080
    proxy: {
      '/config': 'http://localhost:8080',
      '/api':    'http://localhost:8080',
      '/events': {
        target: 'http://localhost:8080',
        // SSE cần changeOrigin + rewriteRequestHeaders để keep connection alive
        changeOrigin: true,
      },
    },
  },
})
