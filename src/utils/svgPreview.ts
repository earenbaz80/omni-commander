/**
 * Converts raw SVG markup into a data URL that can be used as an <img> source.
 *
 * Rendering untrusted SVG through <img src> is safe: scripts and event handlers
 * inside the SVG do not execute (unlike injecting the markup via innerHTML),
 * which prevents XSS when previewing arbitrary .svg files.
 */
export function createSvgDataUrl(svgContent: string): string {
  const encoded = encodeURIComponent(svgContent).replace(/'/g, '%27');
  return `data:image/svg+xml,${encoded}`;
}
