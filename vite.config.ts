import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'

export default defineConfig({
  // Relative base so the build works under any subpath (GitHub Pages
  // project sites serve from /repo-name/, not domain root) — and, unlike an
  // absolute '/repo-name/' base, doesn't trip up vite-plugin-cesium, which
  // uses this same value both for URLs baked into the build AND as the
  // physical destination it copies Cesium's static assets to.
  base: './',
  plugins: [react(), cesium()],
})
