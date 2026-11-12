import { describe, expect, it } from 'vitest';
import { bestInk, contrastRatio, readableInk } from './contrast';

/**
 * The cursor block sits on the row's selection colour, and the settings offer
 * its hue independently of that colour: the pair has to stay legible whatever
 * the two choices are.
 */
describe('readableInk', () => {
  it('keeps the preferred hue when it stands out', () => {
    expect(readableInk('#fcd34d', '#000000', '#ffffff')).toBe('#fcd34d');
  });

  it('falls back when the block would disappear into the row', () => {
    // Cyan on the default cyan selection bar: the case that was invisible.
    expect(readableInk('#67e8f9', '#00ffff', '#000000')).toBe('#000000');
  });

  it('reads three digit and mixed case colours', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 0);
    expect(readableInk('#FFF', '#000000', '#000000')).toBe('#FFF');
  });

  it('picks black or white to match the surface', () => {
    expect(bestInk('#00ffff')).toBe('#000000');
    expect(bestInk('#000084')).toBe('#ffffff');
  });

  it('uses the fallback when a colour cannot be parsed', () => {
    expect(readableInk('rebeccapurple', '#000000', '#ffffff')).toBe('#ffffff');
  });
});
