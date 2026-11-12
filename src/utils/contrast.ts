/**
 * Colour maths for keeping an ink legible on a surface the theme chose.
 *
 * The file list paints the focused row with the user's selection colour and
 * draw the cursor block in a palette of its own; when the two are close — a
 * cyan block on a cyan bar — the block disappears.
 */

/** RGB channels of an `#rrggbb` or `#rgb` colour, or null when it is not one. */
function channels(hex: string): [number, number, number] | null {
  const value = hex.trim().replace(/^#/, '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/** The same colour darker, used for the selection behind the cursor row. */
export function darken(hex: string, amount: number): string {
  const rgb = channels(hex);
  if (!rgb) return hex;
  const factor = Math.min(1, Math.max(0, amount));
  return (
    '#' +
    rgb
      .map((channel) =>
        Math.round(channel * (1 - factor))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** WCAG relative luminance, 0 for black and 1 for white. */
export function relativeLuminance(hex: string): number {
  const rgb = channels(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, from 1 (identical) to 21. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Black or white, whichever stands out more on the given surface. */
export function bestInk(background: string): '#000000' | '#ffffff' {
  return contrastRatio('#000000', background) >= contrastRatio('#ffffff', background) ? '#000000' : '#ffffff';
}

/**
 * The colour an ink should take on a surface: the preferred one when it stands
 * out from the background, the fallback otherwise. Three to one is the smallest
 * ratio WCAG accepts for a non-text graphic, which is what the block is.
 */
export function readableInk(preferred: string, background: string, fallback: string, minimum = 3): string {
  if (channels(preferred) && contrastRatio(preferred, background) >= minimum) return preferred;
  return fallback;
}
