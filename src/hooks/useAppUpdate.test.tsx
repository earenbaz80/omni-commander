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
    onUpdateState: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = bridge;
  return { bridge, emit: (snapshot: unknown) => listeners.forEach((listener) => listener(snapshot)) };
}

const available = { status: 'available', version: '1.0.9', percent: 0, error: null };

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

  it('en el navegador no ofrece actualizaciones y no revienta al pulsar', () => {
    const { result } = renderHook(() => useAppUpdate());

    expect(result.current.supported).toBe(false);
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
      tokenConfigured: false,
      tokenPath: null,
    });
  });

  it('no convierte la basura en un porcentaje inventado', () => {
    expect(normalizeUpdateSnapshot({ status: 'downloading', percent: 'mucho', version: '1.0.9' })).toEqual({
      status: 'downloading',
      version: '1.0.9',
      percent: 0,
      error: null,
      tokenConfigured: false,
      tokenPath: null,
    });
    expect(normalizeUpdateSnapshot(null).status).toBe('idle');
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
