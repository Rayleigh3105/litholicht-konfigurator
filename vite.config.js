import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const odooUrl = env.VITE_ODOO_URL || 'https://litholicht.de'
  const odooApiKey = env.VITE_ODOO_API_KEY || ''

  return {
    root: '.',
    build: {
      outDir: 'dist',
    },
    server: {
      port: 3000,
      proxy: {
        // Proxy API-Calls zu Odoo während der Entwicklung
        '/odoo-api': {
          target: odooUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/odoo-api/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              // API-Key Header für Odoo 19 hinzufügen
              if (odooApiKey) {
                proxyReq.setHeader('api-key', odooApiKey)
              }
            })
          },
        },
      },
    },
  }
})
