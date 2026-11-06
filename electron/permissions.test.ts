// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

/**
 * The window is a file manager, not a browser tab: it must never be able to open
 * the camera, the microphone or the clipboard. These cases pin the two handlers
 * that decide it, with a fake session because the real one only exists inside
 * Electron.
 */
const require = createRequire(import.meta.url);
const { denyAllPermissions } = require('./permissions.cjs') as {
  denyAllPermissions: (session: unknown) => boolean;
};

describe('denyAllPermissions', () => {
  it('deniega cualquier petición de permiso', () => {
    const setPermissionRequestHandler = vi.fn();
    const setPermissionCheckHandler = vi.fn();
    expect(denyAllPermissions({ setPermissionRequestHandler, setPermissionCheckHandler })).toBe(true);
    expect(setPermissionRequestHandler).toHaveBeenCalledTimes(1);

    const request = setPermissionRequestHandler.mock.calls[0][0];
    const callback = vi.fn();
    request({}, 'media', callback);
    request({}, 'geolocation', callback);
    request({}, 'notifications', callback);

    expect(callback).toHaveBeenNthCalledWith(1, false);
    expect(callback).toHaveBeenNthCalledWith(2, false);
    expect(callback).toHaveBeenNthCalledWith(3, false);
  });

  it('responde false también a la comprobación, que es la que sobrevive a una caché', () => {
    const setPermissionRequestHandler = vi.fn();
    const setPermissionCheckHandler = vi.fn();
    denyAllPermissions({ setPermissionRequestHandler, setPermissionCheckHandler });
    expect(setPermissionCheckHandler).toHaveBeenCalledTimes(1);

    const check = setPermissionCheckHandler.mock.calls[0][0];
    expect(check({}, 'media', 'file:///app/dist/index.html')).toBe(false);
    expect(check({}, 'clipboard-read', 'file:///app/dist/index.html')).toBe(false);
  });

  it('no revienta si la sesión no expone los manejadores', () => {
    expect(denyAllPermissions({})).toBe(false);
    expect(denyAllPermissions(null)).toBe(false);
    expect(denyAllPermissions(undefined)).toBe(false);
  });
});
