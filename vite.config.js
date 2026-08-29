import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

// Relative base keeps every localized entry point working when the site is
// deployed under a GitHub Pages repository path such as /PuxiAche/.
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
    rollupOptions: {
      input: {
        root: resolve(rootDir, 'index.html'),
        en: resolve(rootDir, 'en/index.html'),
        pt: resolve(rootDir, 'pt/index.html'),
        es: resolve(rootDir, 'es/index.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
})
