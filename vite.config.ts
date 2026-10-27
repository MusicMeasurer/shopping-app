import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig({
  base: '/shopping-app/',
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['apple-touch-icon.png'],
    manifest: {
      id: '/shopping-app/', name: 'ShoppingApp — списки покупок', short_name: 'Покупки',
      description: 'Два простых списка покупок, доступных без интернета.', lang: 'ru',
      start_url: '/shopping-app/', scope: '/shopping-app/', display: 'standalone',
      background_color: '#f5f6f2', theme_color: '#25634c',
      icons: [192, 512].map(size => ({ src: `icons-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
    },
    workbox: { navigateFallback: '/shopping-app/index.html', globPatterns: ['**/*.{js,css,html,png,webmanifest}'] },
  })],
})
