import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Em dev, o plugin do React injeta um <script> inline (fast refresh) e o Vite usa websocket.
function csp(): Plugin {
  let dev = false
  return {
    name: 'csp',
    configResolved: (c) => void (dev = c.command === 'serve'),
    transformIndexHtml: () => [
      {
        tag: 'meta',
        injectTo: 'head-prepend',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: [
            "default-src 'self'",
            dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "media-src 'self' blob:",
            dev ? "connect-src 'self' ws:" : "connect-src 'self'"
          ].join('; ')
        }
      }
    ]
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), csp()]
  }
})
