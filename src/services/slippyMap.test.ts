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
  tileLayoutFor,
  zoomForPinch,
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
    // Zoom is continuous mid-pinch; only the tiles round.
    expect(clampZoom(10.4)).toBeCloseTo(10.4, 6);
  });

  it('turns the distance between two fingers into a zoom level', () => {
    expect(zoomForPinch(12, 200, 400)).toBeCloseTo(13, 6);
    expect(zoomForPinch(12, 200, 100)).toBeCloseTo(11, 6);
    expect(zoomForPinch(12, 200, 200)).toBeCloseTo(12, 6);
    expect(zoomForPinch(MAX_ZOOM, 200, 400)).toBe(MAX_ZOOM);
    // A second finger that has not moved yet must not divide by zero.
    expect(zoomForPinch(12, 0, 400)).toBe(12);
  });

  it('draws whole-level tiles at a fractional zoom, around the same place', () => {
    const fractional = { ...view, zoom: 12.4 };
    const layout = tileLayoutFor(fractional, 800, 600);
    expect(layout.zoom).toBe(12);
    expect(layout.scale).toBeCloseTo(Math.pow(2, 0.4), 6);

    const centerX = lonToWorldX(fractional.lon, 12);
    const centerY = latToWorldY(fractional.lat, 12);
    const tile = layout.tiles.find(
      (candidate) => candidate.x === Math.floor(centerX / TILE_SIZE) && candidate.y === Math.floor(centerY / TILE_SIZE),
    );
    expect(tile).toBeDefined();
    // The coordinate under the middle of the viewport stays in the middle.
    expect(layout.offsetX + tile!.left + (centerX - tile!.x * TILE_SIZE) * layout.scale).toBeCloseTo(400, 6);
    expect(layout.offsetY + tile!.top + (centerY - tile!.y * TILE_SIZE) * layout.scale).toBeCloseTo(300, 6);
  });

  it('moves the tile layer, not the tiles, when the map is dragged', () => {
    const before = tileLayoutFor(view, 800, 600, { padding: 1 });
    const after = tileLayoutFor(panBy(view, 30, -20), 800, 600, { padding: 1 });
    const shared = after.tiles.filter((tile) => before.tiles.some((other) => other.x === tile.x && other.y === tile.y));
    expect(shared.length).toBeGreaterThan(0);
    for (const tile of shared) {
      const twin = before.tiles.find((other) => other.x === tile.x && other.y === tile.y)!;
      expect(tile.left).toBeCloseTo(twin.left, 6);
      expect(tile.top).toBeCloseTo(twin.top, 6);
    }
    expect(after.offsetX - before.offsetX).toBeCloseTo(30, 6);
    expect(after.offsetY - before.offsetY).toBeCloseTo(-20, 6);
  });

  it('keeps one ring of tiles around the viewport for the next drag', () => {
    const bare = tileLayoutFor(view, 800, 600).tiles;
    const padded = tileLayoutFor(view, 800, 600, { padding: 1 }).tiles;
    expect(padded.length).toBeGreaterThan(bare.length);
    // Four columns and five rows at most: 800/256 rounds up to 4, plus the ring.
    expect(padded.length).toBeLessThanOrEqual(30);
    for (const tile of padded) expect(tile.z).toBe(view.zoom);
  });

  it('reports the visible bounds around the centre', () => {
    const bounds = boundsForView(view, 800, 600);
    expect(bounds.north).toBeGreaterThan(view.lat);
    expect(bounds.south).toBeLessThan(view.lat);
    expect(bounds.west).toBeLessThan(view.lon);
    expect(bounds.east).toBeGreaterThan(view.lon);
  });
});
