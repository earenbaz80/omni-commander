import { describe, expect, it } from 'vitest';
import { TILE_SIZE, tileLayoutFor, tilesCoveringView } from './slippyMap';

const view = { lat: 40.4168, lon: -3.7038, zoom: 12 };

describe('tilesCoveringView', () => {
  it('covers every tile the viewport is drawing', () => {
    const saved = tilesCoveringView(view, 800, 600, 12);
    const drawn = tileLayoutFor(view, 800, 600).tiles;
    expect(saved.length).toBeGreaterThan(0);
    for (const tile of drawn) expect(saved).toContainEqual({ z: tile.z, x: tile.x, y: tile.y });
  });

  it('adds the ring it is asked for, so a short pan still has tiles', () => {
    const bare = tilesCoveringView(view, 800, 600, 12);
    const ringed = tilesCoveringView(view, 800, 600, 12, 1);
    expect(ringed.length).toBeGreaterThan(bare.length);
  });

  it('asks for the level it was given rather than the one on screen', () => {
    const deeper = tilesCoveringView(view, 800, 600, 15);
    expect([...new Set(deeper.map((tile) => tile.z))]).toEqual([15]);
    expect(deeper.length).toBeGreaterThan(tilesCoveringView(view, 800, 600, 12).length);
  });

  it('never asks for a tile outside the world', () => {
    // Straddling the antimeridian: x has to wrap instead of going negative, and
    // a viewport wide enough to wrap twice must not ask for the same tile twice.
    const wrapped = tilesCoveringView({ lat: 0, lon: 179.99, zoom: 3 }, 5000, 600, 3, 2);
    const count = Math.pow(2, 3);
    const keys = new Set(wrapped.map((tile) => `${tile.z}/${tile.x}/${tile.y}`));
    expect(wrapped.length).toBeGreaterThan(0);
    expect(keys.size).toBe(wrapped.length);
    for (const tile of wrapped) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(count);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(count);
    }
    // Sanity: the maths never produce fractional tile numbers.
    for (const tile of wrapped) expect(Number.isInteger(tile.x) && Number.isInteger(tile.y)).toBe(true);
    expect(TILE_SIZE).toBe(256);
  });
});
