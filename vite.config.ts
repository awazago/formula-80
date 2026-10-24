import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

export default defineConfig({
  // Em desenvolvimento, a API roda com `npx wrangler dev` na porta 8787
  server: { proxy: { '/api': 'http://localhost:8787' } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Fórmula 80 · Setlist',
        short_name: 'Fórmula 80',
        description: 'Cifras e setlists da banda Fórmula 80',
        lang: 'pt-BR',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'any',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        // o worker do pdf.js passa de 2 MB
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
        // A API nunca é servida pelo cache do app
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
})
