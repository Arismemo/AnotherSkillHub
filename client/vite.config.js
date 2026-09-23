import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
const backend = `http://127.0.0.1:${process.env.API_PORT || 9444}`

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
      '/s': backend,
    },
  },
})
