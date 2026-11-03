import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
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

describe('MapsModal', () => {
  it('lays its tiles out at a size the browser can paint', () => {
    render(<MapsModal theme={mockTheme} lang="es" onClose={() => {}} />);

    const tiles = [...document.querySelectorAll('img[src*="/api/maps/tile"]')];
    expect(tiles.length).toBeGreaterThan(0);

    // The layer is an empty positioned box, so `img { max-width: 100% }` from the
    // base sheet used to clamp every tile to zero width: the map loaded its
    // images and showed a blank rectangle.
    expect(tiles[0].className).toContain('max-w-none');

    const layer = tiles[0].parentElement as HTMLElement;
    expect(Number.parseFloat(layer.style.width)).toBeGreaterThan(0);
    expect(Number.parseFloat(layer.style.height)).toBeGreaterThan(0);
  });

  it('gives the map window its own title-bar controls', () => {
    render(<MapsModal theme={mockTheme} lang="es" onClose={() => {}} />);

    expect(document.querySelector('[aria-label="Minimizar"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Maximizar / Restaurar"]')).toBeTruthy();
  });
});
