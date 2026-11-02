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
    setUpdateChannel: vi.fn(async (channel: string): Promise<Record<string, unknown>> => ({
      ...(state as object),
      status: 'idle',
      channel,
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

  it('cambiar de canal refleja lo que el proceso principal aplicó', async () => {
    const { bridge } = installBridge(available);
    const { result } = renderHook(() => useAppUpdate());
    await waitFor(() => expect(result.current.status).toBe('available'));

    await act(async () => {
      await result.current.setChannel('beta');
    });

    expect(bridge.setUpdateChannel).toHaveBeenCalledWith('beta');
    // The reply is authoritative: the switch cancels whatever verdict the other
    // feed had produced.
    expect(result.current.channel).toBe('beta');
    expect(result.current.status).toBe('idle');
  });

  it('vuelve al canal estable al desmarcar la casilla', async () => {
    const { bridge } = installBridge({ ...available, channel: 'beta' });
    const { result } = renderHook(() => useAppUpdate());
    await waitFor(() => expect(result.current.channel).toBe('beta'));

    await act(async () => {
      await result.current.setChannel('stable');
    });

    expect(bridge.setUpdateChannel).toHaveBeenCalledWith('stable');
    expect(result.current.channel).toBe('stable');
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

    act(() => result.current.openExternal?.('https://github.com/earenbaz80/omni-commander'));

    expect(bridge.openExternal).toHaveBeenCalledWith('https://github.com/earenbaz80/omni-commander');
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
      channel: 'stable',
    });
  });

  it('no convierte la basura en un porcentaje inventado', () => {
    expect(normalizeUpdateSnapshot({ status: 'downloading', percent: 'mucho', version: '1.0.9' })).toEqual({
      status: 'downloading',
      version: '1.0.9',
      percent: 0,
      error: null,
      enabled: false,
      channel: 'stable',
    });
    expect(normalizeUpdateSnapshot(null).status).toBe('idle');
  });

  it('solo beta opta por las versiones de prueba', async () => {
    // A test build must never be offered because of a stray value: anything that
    // is not exactly `beta` stays on the stable feed.
    expect(normalizeUpdateSnapshot({ status: 'idle', channel: 'beta' }).channel).toBe('beta');
    expect(normalizeUpdateSnapshot({ status: 'idle', channel: 'prerelease' }).channel).toBe('stable');
    expect(normalizeUpdateSnapshot({ status: 'idle', channel: true }).channel).toBe('stable');
    expect(normalizeUpdateSnapshot(null).channel).toBe('stable');
  });
});
