import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
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
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        // Follows the same port the local server binds. Override with OMNI_API_PORT
        // when the server had to walk past a busy 3001.
        '/api': `http://127.0.0.1:${process.env.OMNI_API_PORT || process.env.PORT || 3001}`,
      },
    },
    build: {
      chunkSizeWarningLimit: 1000,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    },
  };
});
