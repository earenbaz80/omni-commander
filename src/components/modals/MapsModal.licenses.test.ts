import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { MAP_LAYERS } from './MapsModal';

/**
 * The attribution under the map is a link, and the shell refuses every URL it
 * does not know. The list of allowed pages and the list of layers live in two
 * different worlds (Electron main and the renderer), so the coupling is tested
 * here: a layer whose licence page is not allowed would render a link that does
 * nothing when clicked, which is exactly the bug this guards against.
 */
const require = createRequire(import.meta.url);
const { isAllowedExternalTarget } = require('../../../electron/externalLinks.cjs') as {
  isAllowedExternalTarget: (target: unknown) => boolean;
};

describe('atribuciones del mapa', () => {
  it('cada capa lleva un enlace que el shell deja abrir', () => {
    expect(MAP_LAYERS.length).toBeGreaterThan(0);
    for (const layer of MAP_LAYERS) {
      expect(isAllowedExternalTarget(layer.licenseUrl), `capa ${layer.id}: ${layer.licenseUrl}`).toBe(true);
    }
  });

  it('el filtro sigue siendo estrecho: no vale cualquier https', () => {
    expect(isAllowedExternalTarget('https://example.com/')).toBe(false);
    expect(isAllowedExternalTarget('https://www.openstreetmap.org/other')).toBe(false);
  });
});
