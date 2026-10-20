import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Files shared with the Python side (clinical_copy.json) live outside
      // frontend-new so the backend can read the same bytes. An alias rather
      // than a relative path, so a move of src/ does not silently break it.
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/") || id.includes("node_modules/react-router")) {
            return "react-vendor"
          }
          if (id.includes("node_modules/framer-motion")) {
            return "motion"
          }
        },
      },
    },
  },
})