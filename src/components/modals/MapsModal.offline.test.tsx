import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MapsModal } from './MapsModal';
import { ThemeConfig } from '../../services/themeManager';

const mockTheme = {
  overlay: '#00000088',
  modalBg: '#f5f5f5',
  modalBorder: '#cccccc',
  modalHeaderBg: '#ffffff',
  modalHeaderText: '#000000',
  isRetro: false,
} as ThemeConfig;

beforeAll(() => {
  // jsdom has no layout engine, so the observer the viewport uses is missing.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const open = () => render(<MapsModal theme={mockTheme} lang="es" onClose={() => {}} />);

describe('MapsModal layers and offline use', () => {
  it('says how much the offline cache holds and empties it on request', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (String(url).includes('/api/maps/cache')) {
        return {
          ok: true,
          json: async () => (init?.method === 'DELETE' ? { removed: 120, bytes: 0 } : { tiles: 120, bytes: 3355443 }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    open();

    // The dialog opens on what the disk actually holds, not on a guess: the same
    // folder that makes the map work offline is the one being reported.
    expect(await screen.findByText(/120/)).toBeTruthy();
    expect(document.body.textContent).toContain('3.2 MB');

    fireEvent.click(screen.getByTitle('Vaciar la caché'));

    await waitFor(() => expect(document.body.textContent).toContain('Caché vaciada'));
    const clear = calls.find((entry) => entry.startsWith('DELETE'));
    expect(clear).toContain('/api/maps/cache');
    expect(document.body.textContent).toContain('Sin teselas guardadas');
    vi.unstubAllGlobals();
  });

  it('offers the five OSM renders that need no account', () => {
    open();
    for (const label of ['OSM estándar', 'Humanitario', 'Cicloturismo', 'Topográfico', 'Transporte público']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // The attribution follows the layer instead of naming a service that may
    // not be the one on screen.
    expect(document.body.textContent).toContain('© OpenStreetMap contributors');
  });

  it('asks before downloading the world, then sends exactly the levels promised', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/api/maps/cache')) return { ok: true, json: async () => ({ tiles: 0, bytes: 0 }) };
      return { ok: true, json: async () => ({ stored: 1, failed: 0 }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    open();

    // Level 0 is a single tile, which keeps this test about the flow rather
    // than about how large the world is.
    fireEvent.change(screen.getByLabelText('Nivel máximo'), { target: { value: '0' } });
    fireEvent.click(screen.getByTitle('Descargar el mundo'));
    expect(document.body.textContent).toContain('política de uso de OpenStreetMap');

    fireEvent.click(screen.getByText('Descargar ahora'));
    await waitFor(() => expect(document.body.textContent).toContain('Zona guardada para consultarla sin conexión'));

    const post = calls.find((call) => call.url.includes('/api/maps/offline') && call.init?.method === 'POST');
    expect(post).toBeTruthy();
    const body = JSON.parse(String((post as { init?: RequestInit }).init?.body)) as {
      tiles: Array<{ z: number; x: number; y: number }>;
    };
    expect(body.tiles).toEqual([{ z: 0, x: 0, y: 0 }]);
    vi.unstubAllGlobals();
  });

  it('asks the server to save the visible area', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ stored: 40, skipped: 0, failed: 0 }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    open();

    fireEvent.click(screen.getByTitle('Guardar zona'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // The dialog now also asks how much the cache holds when it opens, so the
    // save is the request that carries tiles rather than simply the first one.
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const save = calls.find(
      ([target, init]) => String(target).includes('/api/maps/offline') && init?.method === 'POST',
    );
    expect(save).toBeTruthy();
    const [url, init] = save as [string, RequestInit];
    expect(String(url)).toContain('/api/maps/offline');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as { layer: string; tiles: Array<Record<string, number>> };
    expect(body.layer).toBe('osm');
    expect(body.tiles.length).toBeGreaterThan(0);
    expect(body.tiles[0]).toMatchObject({ z: expect.any(Number), x: expect.any(Number), y: expect.any(Number) });
    await waitFor(() => expect(screen.getByText('Zona guardada para consultarla sin conexión')).toBeTruthy());
    vi.unstubAllGlobals();
  });

  it('says the map is on saved tiles once the window loses its connection', async () => {
    open();
    expect(document.body.textContent).not.toContain('Sin conexión');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    fireEvent(window, new Event('offline'));
    expect(await screen.findByText(/Sin conexión/)).toBeTruthy();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
  });
});
