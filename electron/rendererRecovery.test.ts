// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * A dead renderer leaves the app running with a window that paints nothing, so
 * the reload is the only way back to a usable interface — and a renderer that
 * dies on every load must not be reloaded forever.
 */
const require = createRequire(import.meta.url);
const { MAX_RENDERER_RELOADS, rendererGoneLine, canReloadRenderer } = require('./rendererRecovery.cjs') as {
  MAX_RENDERER_RELOADS: number;
  rendererGoneLine: (details?: { reason?: unknown; exitCode?: unknown } | null) => string;
  canReloadRenderer: (crashes: number, max?: number) => boolean;
};

describe('recuperación del renderer', () => {
  it('deja escrito por qué murió', () => {
    expect(rendererGoneLine({ reason: 'crashed', exitCode: 139 })).toBe('reason=crashed exitCode=139');
  });

  it('no inventa un motivo que no le dan', () => {
    expect(rendererGoneLine(undefined)).toBe('reason=unknown exitCode=unknown');
    expect(rendererGoneLine({ reason: '', exitCode: null })).toBe('reason=unknown exitCode=unknown');
  });

  it('recarga mientras queden intentos', () => {
    expect(canReloadRenderer(0)).toBe(true);
    expect(canReloadRenderer(MAX_RENDERER_RELOADS - 1)).toBe(true);
  });

  it('deja de recargar cuando los intentos se agotan', () => {
    expect(canReloadRenderer(MAX_RENDERER_RELOADS)).toBe(false);
    expect(canReloadRenderer(MAX_RENDERER_RELOADS + 1)).toBe(false);
  });

  it('no recarga con un contador que no es un número', () => {
    expect(canReloadRenderer(Number.NaN)).toBe(false);
  });
});
