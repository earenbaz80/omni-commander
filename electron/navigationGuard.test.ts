import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The window that loads these documents runs with the preload bridge, so it
 * holds the session token for the local API: a remote document there could read
 * the whole disk. The guard is compared against what a browser and Node actually
 * parse, not against prefixes, which is where the two holes came from.
 */
const require = createRequire(import.meta.url);
const { isAllowedNavigationUrl } = require('./navigationGuard.cjs') as {
  isAllowedNavigationUrl: (target: string, options?: { isDev?: boolean; distDir?: string }) => boolean;
};

const distDir = path.resolve(__dirname, '..', 'dist');
const dev = { isDev: true, distDir };
const packaged = { isDev: false, distDir };

const fileIn = (...segments: string[]) => pathToFileURL(path.join(distDir, ...segments)).href;

describe('navegación permitida en Electron', () => {
  it('acepta el origen del servidor de desarrollo y sus rutas', () => {
    expect(isAllowedNavigationUrl('http://localhost:3000/', dev)).toBe(true);
    expect(isAllowedNavigationUrl('http://localhost:3000/#/panels/left', dev)).toBe(true);
  });

  it('rechaza la URL donde el puerto es el usuario y no el host', () => {
    // The audit's example: `localhost:3000` as a user name, Evil as the host.
    expect(isAllowedNavigationUrl('http://localhost:3000@evil.example/', dev)).toBe(false);
  });

  it('rechaza otros hosts, puertos y esquemas que empiezan igual', () => {
    for (const target of [
      'http://localhost:3000.evil.example/',
      'http://localhost:3001/',
      'http://127.0.0.1:3000/',
      'https://localhost:3000/',
      'http://localhost:30000/',
    ]) {
      expect(isAllowedNavigationUrl(target, dev)).toBe(false);
    }
  });

  it('deja el servidor de desarrollo fuera del paquete empaquetado', () => {
    expect(isAllowedNavigationUrl('http://localhost:3000/', packaged)).toBe(false);
  });

  it('acepta los ficheros del renderer empaquetado', () => {
    expect(isAllowedNavigationUrl(fileIn('index.html'), packaged)).toBe(true);
    expect(isAllowedNavigationUrl(fileIn('assets', 'index-abc.js'), packaged)).toBe(true);
  });

  it('rechaza cualquier otro fichero del disco', () => {
    const outside = pathToFileURL(path.resolve(distDir, '..', 'server.cjs')).href;
    expect(isAllowedNavigationUrl(outside, packaged)).toBe(false);
    expect(isAllowedNavigationUrl('file:///C:/Windows/win.ini', packaged)).toBe(false);
  });

  it('rechaza una carpeta, que no es un documento', () => {
    expect(isAllowedNavigationUrl(pathToFileURL(distDir).href, packaged)).toBe(false);
  });

  it('rechaza una ruta que sale de dist con .. codificado', () => {
    const escaped = `${pathToFileURL(distDir).href}/%2e%2e/server.cjs`;
    expect(isAllowedNavigationUrl(escaped, packaged)).toBe(false);
  });

  it('rechaza una ruta de red, que es otro equipo', () => {
    expect(isAllowedNavigationUrl('file://server/share/document.html', packaged)).toBe(false);
    expect(isAllowedNavigationUrl('file://server/share/document.html', dev)).toBe(false);
  });

  it('rechaza esquemas que no son documentos locales', () => {
    for (const target of ['about:blank', 'javascript:alert(1)', 'data:text/html,<b>x</b>', '']) {
      expect(isAllowedNavigationUrl(target, packaged)).toBe(false);
    }
  });
});
