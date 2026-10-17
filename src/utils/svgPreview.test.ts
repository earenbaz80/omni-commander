import { describe, it, expect } from 'vitest';
import { createSvgDataUrl } from './svgPreview';

describe('createSvgDataUrl', () => {
  it('produces a data URL usable as an <img> source for the SVG', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const url = createSvgDataUrl(svg);

    expect(url.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(url.replace(/^data:image\/svg\+xml[^,]*,/, ''))).toBe(svg);
  });

  it('encodes executable markup so a scripted SVG cannot run as raw HTML', () => {
    const malicious = '<svg onload="window.__xss=1"><script>window.__xss=2</script></svg>';
    const url = createSvgDataUrl(malicious);

    expect(url).not.toContain('<script>');
    expect(url).not.toContain('<svg');
    expect(url).not.toContain('onload=');
  });
});
