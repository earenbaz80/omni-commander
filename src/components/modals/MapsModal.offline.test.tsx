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
  it('offers the five OSM renders that need no account', () => {
    open();
    for (const label of ['OSM estándar', 'Humanitario', 'Cicloturismo', 'Topográfico', 'Transporte público']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // The attribution follows the layer instead of naming a service that may
    // not be the one on screen.
    expect(document.body.textContent).toContain('© OpenStreetMap contributors');
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
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
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
