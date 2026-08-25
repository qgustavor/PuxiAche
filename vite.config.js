import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// Relative base makes the built site work under https://<user>.github.io/<repo>/
// without needing to know the repo name at build time.

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      pwaAssets: {},
      workbox: {
        // Allow up to 5 MiB (5 * 1024 * 1024 = 5242880 bytes)
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    })
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
})
