import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: '../ios/App/Resources/Web', emptyOutDir: true, target: 'safari17' },
  server: { port: 4173 },
})
