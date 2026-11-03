import { describe, it, expect } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_SIZE,
  clampLatitude,
  clampZoom,
  latToWorldY,
  lonToWorldX,
  panBy,
  projectToScreen,
  tilesForView,
  unprojectFromScreen,
  worldXToLon,
  worldYToLat,
  wrapLongitude,
  zoomAround,
  boundsForView,
} from './slippyMap';

const view = { lat: 40.4168, lon: -3.7038, zoom: 12 };

describe('slippy map maths', () => {
  it('round-trips a coordinate through world pixels', () => {
    const x = lonToWorldX(view.lon, view.zoom);
    const y = latToWorldY(view.lat, view.zoom);
    expect(worldXToLon(x, view.zoom)).toBeCloseTo(view.lon, 6);
    expect(worldYToLat(y, view.zoom)).toBeCloseTo(view.lat, 6);
  });

  it('puts the centre in the middle of the viewport', () => {
    expect(projectToScreen(view, view, 800, 600)).toEqual({ x: 400, y: 300 });
    const back = unprojectFromScreen({ x: 400, y: 300 }, view, 800, 600);
    expect(back.lat).toBeCloseTo(view.lat, 6);
    expect(back.lon).toBeCloseTo(view.lon, 6);
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const anchor = { x: 650, y: 120 };
    const before = unprojectFromScreen(anchor, view, 800, 600);
    const zoomed = zoomAround(view, 2, anchor, 800, 600);
    expect(zoomed.zoom).toBe(14);
    const after = unprojectFromScreen(anchor, zoomed, 800, 600);
    expect(after.lat).toBeCloseTo(before.lat, 4);
    expect(after.lon).toBeCloseTo(before.lon, 4);
  });

  it('pans by the drag offset and back', () => {
    const moved = panBy(view, 120, -80);
    // Dragging the map right and up walks the centre west and south.
    expect(moved.lat).toBeLessThan(view.lat);
    expect(moved.lon).toBeLessThan(view.lon);
    const back = panBy(moved, -120, 80);
    expect(back.lat).toBeCloseTo(view.lat, 6);
    expect(back.lon).toBeCloseTo(view.lon, 6);
  });

  it('covers the viewport with tiles, at most one row and column beyond it', () => {
    const tiles = tilesForView(view, 800, 600);
    const columns = new Set(tiles.map((tile) => tile.x));
    const rows = new Set(tiles.map((tile) => tile.y));
    expect(columns.size).toBeLessThanOrEqual(Math.ceil(800 / TILE_SIZE) + 2);
    expect(rows.size).toBeLessThanOrEqual(Math.ceil(600 / TILE_SIZE) + 2);
    for (const tile of tiles) {
      expect(tile.left).toBeGreaterThan(-TILE_SIZE);
      expect(tile.left).toBeLessThan(800);
      expect(tile.top).toBeGreaterThan(-TILE_SIZE);
      expect(tile.top).toBeLessThan(600);
      expect(tile.z).toBe(view.zoom);
    }
  });

  it('never returns tiles outside the world', () => {
    const edge = { lat: 0, lon: -179.9, zoom: 3 };
    for (const tile of tilesForView(edge, 800, 600)) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(8);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(8);
    }
  });

  it('clamps latitude, wraps longitude and bounds the zoom', () => {
    expect(clampLatitude(89)).toBeLessThan(86);
    expect(clampLatitude(-89)).toBeGreaterThan(-86);
    expect(wrapLongitude(190)).toBeCloseTo(-170, 6);
    expect(wrapLongitude(-190)).toBeCloseTo(170, 6);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(25)).toBe(MAX_ZOOM);
    expect(clampZoom(10.4)).toBe(10);
  });

  it('reports the visible bounds around the centre', () => {
    const bounds = boundsForView(view, 800, 600);
    expect(bounds.north).toBeGreaterThan(view.lat);
    expect(bounds.south).toBeLessThan(view.lat);
    expect(bounds.west).toBeLessThan(view.lon);
    expect(bounds.east).toBeGreaterThan(view.lon);
  });
});
