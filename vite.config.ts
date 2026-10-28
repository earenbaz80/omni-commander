import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // Vite does not populate process.env from .env on its own, so a PORT set there
  // would be ignored here and the dev proxy would keep pointing at 3001 while the
  // API server listens somewhere else. Load the same file that `npm run server`
  // reads, letting the real environment win, which is what dotenv-style loading
  // does too.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  // The API only answers the app's own origin, port included, and that port is
  // fixed at 3000 (the dev script uses `strictPort`). A dev server can still be
  // started elsewhere, so the proxy presents the canonical origin instead of the
  // one the browser happened to use; the browser's request stays same-origin
  // either way. Only loopback origins are rewritten: a page from anywhere else
  // keeps its origin and the server refuses it.
  const DEV_UI_PORT = 3000;
  const isLoopbackOrigin = (origin: string) => {
    try {
      const url = new URL(origin);
      const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      return url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(host);
    } catch {
      return false;
    }
  };

  // Inside Electron the app is already installed locally, so the PWA service
  // worker adds nothing and can serve stale cached assets. Skip it there.
  const isElectronBuild = mode === 'electron';
  return {
    // The packaged Electron renderer is loaded via file://, where absolute
    // "/assets/..." URLs resolve to the drive root and never load (blank window).
    // Relative URLs are required for the Electron build only.
    base: isElectronBuild ? './' : '/',
    plugins: [
      react(),
      tailwindcss(),
      ...(isElectronBuild
        ? []
        : [
            VitePWA({
              registerType: 'autoUpdate',
              includeAssets: ['icon.svg', 'icon-512.png', 'icon-192.png'],
              manifest: {
                id: '/',
                name: 'OmniCommander Pro for Windows',
                short_name: 'OmniCmd',
                description:
                  'Potente administrador de archivos de doble panel con pestañas, multi-nube y herramientas DOS.',
                theme_color: '#000080',
                background_color: '#0c101c',
                display: 'standalone',
                start_url: '/',
                scope: '/',
                icons: [
                  {
                    src: '/icon.svg',
                    sizes: '512x512',
                    type: 'image/svg+xml',
                    purpose: 'any',
                  },
                  {
                    src: '/icon-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any',
                  },
                ],
              },
              devOptions: {
                enabled: false,
              },
            }),
          ]),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    optimizeDeps: {
      exclude: ['libarchive.js'],
    },
    server: {
      // HMR and file watching are separate switches on purpose. Turning HMR off
      // used to disable the watcher too, and without a watcher the dev server
      // never invalidates a transformed module: a browser reload kept getting
      // the code from before the server started, so a fixed component looked
      // broken until the process was restarted. Only the live-reload channel is
      // optional; invalidation is not.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {},
      proxy: {
        // Follows the same port the local server binds. Override with OMNI_API_PORT
        // when the server had to walk past a busy 3001. The numeric coercion keeps
        // "0" and garbage out: server.cjs reads them as 3001, so the proxy must too.
        '/api': {
          target: `http://127.0.0.1:${Number(process.env.OMNI_API_PORT || process.env.PORT) || 3001}`,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              const origin = String(proxyReq.getHeader('origin') || '');
              if (isLoopbackOrigin(origin)) {
                proxyReq.setHeader('origin', `http://localhost:${DEV_UI_PORT}`);
              }
            });
          },
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 1000,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      // Shared wait budget for the async queries, so a loaded machine does not
      // fail components that are only slow to render. See the file for why.
      setupFiles: ['./src/test/setup.ts'],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    },
  };
});
