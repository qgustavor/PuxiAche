import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Relative base makes the built site work under https://<user>.github.io/<repo>/
// without needing to know the repo name at build time.

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
})
