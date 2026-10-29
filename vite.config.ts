import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The version the About box and the shell report comes from the file the package
// is built from. It used to be a literal in the component, which drifted: the
// build said v5.50.2026 while package.json said 1.0.4.
// Vite loads this config with the project root as cwd; resolving from there also
// works when the config is imported by a test, where `import.meta.url` is not a
// file URL.
const appVersion = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')).version as string;

export default defineConfig(({ command, mode }) => {
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

  // The product works with no connection, so the document says so to the
  // browser: nothing but its own files and the local API may load. This is
  // injected here rather than written in index.html because the dev server
  // needs two exceptions that the shipped build must not carry -- Vite hands
  // React's refresh preamble over as an inline script, and HMR talks over a
  // websocket -- so the policy is built per mode and injected into <head>
  // before any resource tag, which is where a meta policy still applies.
  const isDevServer = command === 'serve';
  const contentSecurityPolicy = [
    "default-src 'self'",
    isDevServer ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    // Every theme is applied as inline style attributes, and in development
    // Vite delivers the CSS in <style> tags: narrowing this would mean
    // repainting the whole interface through classes first.
    "style-src 'self' 'unsafe-inline'",
    // Previews come from blob: object URLs, and the SVG viewer builds a data: URL.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The archive bridge and libarchive's wasm worker load from the bundle.
    "worker-src 'self' blob:",
    // The only server this page may reach is the local API, on whichever port it
    // managed to bind; the dev server additionally needs its own websocket.
    `connect-src 'self' http://127.0.0.1:* http://localhost:*${isDevServer ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'self'",
  ].join('; ');

  const contentSecurityPolicyMeta = {
    name: 'omni-content-security-policy',
    transformIndexHtml: {
      order: 'post' as const,
      handler: (html: string) =>
        html.replace(
          /<head(\s[^>]*)?>/i,
          (head) => `${head}\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />`,
        ),
    },
  };

  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    // The packaged Electron renderer is loaded via file://, where absolute
    // "/assets/..." URLs resolve to the drive root and never load (blank window).
    // Relative URLs are required for the Electron build only.
    base: isElectronBuild ? './' : '/',
    plugins: [
      react(),
      tailwindcss(),
      contentSecurityPolicyMeta,
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
