import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup, act, waitFor } from '@testing-library/react';
import { useAppUpdate, normalizeUpdateSnapshot } from './useAppUpdate';

type Listener = (snapshot: unknown) => void;

/**
 * Stands in for preload.cjs: keeps the listeners the hook registers and records
 * every call, so the test checks the contract rather than a React detail.
 */
function installBridge(state: unknown) {
  const listeners = new Set<Listener>();
  const bridge = {
    checkForUpdates: vi.fn(async () => state),
    downloadUpdate: vi.fn(async () => state),
    installUpdate: vi.fn(async () => true),
    getUpdateState: vi.fn(async () => state),
    openExternal: vi.fn(async () => true),
    setUpdateToken: vi.fn(async (): Promise<Record<string, unknown>> => ({
      ...(state as object),
      accepted: true,
      tokenConfigured: true,
    })),
    clearUpdateToken: vi.fn(async (): Promise<Record<string, unknown>> => ({
      ...(state as object),
      tokenConfigured: false,
      tokenSource: null,
    })),
    onUpdateState: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = bridge;
  return { bridge, emit: (snapshot: unknown) => listeners.forEach((listener) => listener(snapshot)) };
}

const available = { status: 'available', version: '1.0.9', percent: 0, error: null, enabled: true };

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('useAppUpdate', () => {
  it('lee el estado actual al montar, porque el primer chequeo llega antes', async () => {
    const { bridge } = installBridge(available);

    const { result } = renderHook(() => useAppUpdate());

    await waitFor(() => expect(result.current.status).toBe('available'));
    expect(bridge.getUpdateState).toHaveBeenCalledTimes(1);
    expect(result.current.version).toBe('1.0.9');
    expect(result.current.supported).toBe(true);
    expect(result.current.enabled).toBe(true);
  });

  it('refleja lo que empuja el proceso principal mientras el modal está abierto', async () => {
    const { emit } = installBridge({ status: 'idle', version: null, percent: 0, error: null });

    const { result } = renderHook(() => useAppUpdate());
    act(() => emit({ status: 'downloading', version: '1.0.9', percent: 42, error: null }));
    expect(result.current.status).toBe('downloading');
    expect(result.current.percent).toBe(42);

    act(() => emit({ status: 'downloaded', version: '1.0.9', percent: 100, error: null }));
    expect(result.current.status).toBe('downloaded');
  });

  it('guardar un token refleja el estado que devuelve el proceso principal', async () => {
    const { bridge } = installBridge({ status: 'error', error: '404', tokenPath: 'C:\\datos\\update-token' });
    const { result } = renderHook(() => useAppUpdate());

    let accepted = false;
    await act(async () => {
      accepted = await result.current.setToken('ghp_0123456789abcdefghijklmnopqrstuvwx');
    });

    expect(accepted).toBe(true);
    expect(bridge.setUpdateToken).toHaveBeenCalledWith('ghp_0123456789abcdefghijklmnopqrstuvwx');
    expect(result.current.tokenConfigured).toBe(true);
  });

  it('un valor rechazado no se da por guardado', async () => {
    const { bridge } = installBridge({ status: 'error', error: '404' });
    bridge.setUpdateToken.mockResolvedValueOnce({ status: 'error', accepted: false });
    const { result } = renderHook(() => useAppUpdate());

    let accepted = true;
    await act(async () => {
      accepted = await result.current.setToken('change-me');
    });

    expect(accepted).toBe(false);
    expect(result.current.tokenConfigured).toBe(false);
  });

  it('quitar el token deja el estado sin credencial', async () => {
    const { bridge } = installBridge({ status: 'idle', tokenConfigured: true, tokenSource: 'file' });
    const { result } = renderHook(() => useAppUpdate());
    await waitFor(() => expect(result.current.tokenConfigured).toBe(true));

    await act(async () => {
      await result.current.clearToken();
    });

    expect(bridge.clearUpdateToken).toHaveBeenCalledTimes(1);
    expect(result.current.tokenConfigured).toBe(false);
  });

  it('no da el updater por disponible si el proceso principal no lo tiene', () => {
    // Development and the portable package have no installed copy to replace, so
    // the interface must not offer controls that cannot work.
    installBridge({ status: 'idle', enabled: false });
    const { result } = renderHook(() => useAppUpdate());

    expect(result.current.supported).toBe(true);
    expect(result.current.enabled).toBe(false);
  });

  it('cada acción llama a su función del puente', async () => {
    const { bridge } = installBridge(available);
    const { result } = renderHook(() => useAppUpdate());
    await waitFor(() => expect(result.current.status).toBe('available'));

    act(() => result.current.download());
    act(() => result.current.install());
    act(() => result.current.check());

    expect(bridge.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(bridge.installUpdate).toHaveBeenCalledTimes(1);
    expect(bridge.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('abre un enlace por el proceso principal cuando existe el puente', async () => {
    const { bridge } = installBridge(available);
    const { result } = renderHook(() => useAppUpdate());

    act(() => result.current.openExternal?.('https://github.com/settings/personal-access-tokens/new'));

    expect(bridge.openExternal).toHaveBeenCalledWith('https://github.com/settings/personal-access-tokens/new');
  });

  it('en el navegador no ofrece actualizaciones y no revienta al pulsar', () => {
    const { result } = renderHook(() => useAppUpdate());

    expect(result.current.supported).toBe(false);
    // Without a main process the anchor keeps its normal behaviour.
    expect(result.current.openExternal).toBeNull();
    expect(() => result.current.check()).not.toThrow();
    expect(() => result.current.install()).not.toThrow();
  });
});

describe('normalizeUpdateSnapshot', () => {
  // The preload and the main process can drift across versions, and a status the
  // interface cannot render must not reach it.
  it('descarta un estado desconocido y los campos mal tipados', () => {
    expect(normalizeUpdateSnapshot({ status: 'explotando', version: '', percent: 250, error: 7 })).toEqual({
      status: 'idle',
      version: null,
      percent: 100,
      error: null,
      enabled: false,
      tokenConfigured: false,
      tokenSource: null,
      tokenPath: null,
      tokenExpiresAt: null,
    });
  });

  it('no convierte la basura en un porcentaje inventado', () => {
    expect(normalizeUpdateSnapshot({ status: 'downloading', percent: 'mucho', version: '1.0.9' })).toEqual({
      status: 'downloading',
      version: '1.0.9',
      percent: 0,
      error: null,
      enabled: false,
      tokenConfigured: false,
      tokenSource: null,
      tokenPath: null,
      tokenExpiresAt: null,
    });
    expect(normalizeUpdateSnapshot(null).status).toBe('idle');
  });

  it('solo acepta la fecha de caducidad con la forma que escribe el campo de fecha', () => {
    // Anything else would be formatted as a date the settings cannot read, so it
    // is treated as "no date recorded" instead of being shown as-is.
    expect(normalizeUpdateSnapshot({ tokenExpiresAt: '2027-01-12' }).tokenExpiresAt).toBe('2027-01-12');
    expect(normalizeUpdateSnapshot({ tokenExpiresAt: '12/01/2027' }).tokenExpiresAt).toBeNull();
    expect(normalizeUpdateSnapshot({ tokenExpiresAt: 'nunca' }).tokenExpiresAt).toBeNull();
    expect(normalizeUpdateSnapshot({ tokenExpiresAt: 20270112 }).tokenExpiresAt).toBeNull();
  });

  it('solo da por configurado un token que llega como verdadero y con ruta utilizable', () => {
    // The interface uses this to decide whether it can tell the user where to put
    // a credential: a truthy string from an older preload must not pass as "yes".
    expect(normalizeUpdateSnapshot({ status: 'error', tokenConfigured: 'sí', tokenPath: 42 })).toMatchObject({
      tokenConfigured: false,
      tokenPath: null,
    });
    expect(normalizeUpdateSnapshot({ status: 'error', tokenConfigured: true, tokenPath: 'C:\\token' })).toMatchObject({
      tokenConfigured: true,
      tokenPath: 'C:\\token',
    });
  });
});
