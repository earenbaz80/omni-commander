import { describe, expect, it } from 'vitest';
import { MAX_LATITUDE, TILE_SIZE, tilesCoveringRect } from './slippyMap';

const columnsAt = (zoom: number) => Math.pow(2, zoom);

describe('tilesCoveringRect', () => {
  it('takes the whole world when the box is the whole world', () => {
    // Level 3, the shallowest one with images: `MIN_ZOOM` lifts anything below
    // it, and the whole world at that level is the 64 squares of an 8x8 grid.
    const tiles = tilesCoveringRect({ north: MAX_LATITUDE, south: -MAX_LATITUDE, west: -180, east: 180 }, 3);
    expect(tiles).toHaveLength(64);
    expect(new Set(tiles.map((tile) => `${tile.x}/${tile.y}`)).size).toBe(64);
    expect(tiles.every((tile) => tile.z === 3)).toBe(true);
  });

  it('keeps only the tiles the box touches', () => {
    const tiles = tilesCoveringRect({ north: 40.5, south: 40.4, west: -3.8, east: -3.7 }, 12);
    // Far smaller than the view of the same place: the box is a few blocks.
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(4);
    for (const tile of tiles) {
      expect(Number.isInteger(tile.x)).toBe(true);
      expect(Number.isInteger(tile.y)).toBe(true);
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(columnsAt(12));
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(columnsAt(12));
    }
  });

  it('reads a box dragged from either corner the same way', () => {
    const forward = tilesCoveringRect({ north: 40.5, south: 40.4, west: -3.8, east: -3.7 }, 10);
    const backward = tilesCoveringRect({ north: 40.4, south: 40.5, west: -3.7, east: -3.8 }, 10);
    expect(backward).toEqual(forward);
  });

  it('crosses the antimeridian instead of wrapping the long way round', () => {
    const zoom = 6;
    const count = columnsAt(zoom);
    const tiles = tilesCoveringRect({ north: 1, south: -1, west: 179.9, east: -179.9 }, zoom);

    // Two columns and a handful of rows, not the 64 columns of the whole world.
    expect(tiles.length).toBeLessThanOrEqual(count / 8);
    const columns = new Set(tiles.map((tile) => tile.x));
    expect(columns.has(0)).toBe(true);
    expect(columns.has(count - 1)).toBe(true);
  });

  it('stops at the poles rather than folding onto the other hemisphere', () => {
    const tiles = tilesCoveringRect({ north: 89, south: 88, west: -1, east: 1 }, 4);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((tile) => tile.y >= 0 && tile.y < columnsAt(4))).toBe(true);
  });

  it('adds a ring of tiles when asked, without ever leaving the world', () => {
    const box = { north: 40.5, south: 40.4, west: -3.8, east: -3.7 };
    const plain = tilesCoveringRect(box, 8);
    const ringed = tilesCoveringRect(box, 8, 1);

    expect(ringed.length).toBeGreaterThan(plain.length);
    expect(ringed.every((tile) => tile.x >= 0 && tile.x < columnsAt(8))).toBe(true);
    // A ring is one tile wider on each side of a one-tile box at most.
    const width = (list: typeof plain) => new Set(list.map((tile) => tile.x)).size;
    expect(width(ringed)).toBeLessThanOrEqual(width(plain) + 2);
    expect(TILE_SIZE).toBe(256);
  });

  it('rounds the level, because only whole zoom levels have images', () => {
    const box = { north: 40.5, south: 40.4, west: -3.8, east: -3.7 };
    expect(tilesCoveringRect(box, 7.4).every((tile) => tile.z === 7)).toBe(true);
    expect(tilesCoveringRect(box, 7.6).every((tile) => tile.z === 8)).toBe(true);
  });
});
