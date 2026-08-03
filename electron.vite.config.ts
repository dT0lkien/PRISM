import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const shared = resolve('src/shared')

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: { input: resolve('src/main/index.ts') }
    },
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.js' }
      }
    },
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve('src/renderer/index.html') }
    },
    resolve: { alias: { '@': resolve('src/renderer/src'), '@shared': shared } },
    plugins: [react()]
  }
})
