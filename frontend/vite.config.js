import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: [
      'news-and-podcast-frontend-861840374112.europe-west3.run.app'
    ]
  },
})
