import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ViewerModal } from './modals/ViewerModal';
import { QuickViewPane } from './QuickViewPane';
import { HoverPreviewTooltip } from './HoverPreviewTooltip';
import { themes } from '../services/themeManager';
import { FileItem } from '../types';

const theme = themes.classic_blue;

// An SVG that would execute code if it were injected as raw HTML.
const MALICIOUS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss=1">' +
  '<script>window.__xss=2</script>' +
  '<rect width="10" height="10"/></svg>';

const makeSvgFile = (): FileItem => ({
  id: 'f1',
  name: 'evil',
  ext: 'SVG',
  path: 'C:\\tmp',
  driveId: 'real_C',
  isDirectory: false,
  size: MALICIOUS_SVG.length,
  modifiedAt: '',
  createdAt: '',
  attributes: { readOnly: false, hidden: false, system: false, archive: true },
  content: MALICIOUS_SVG,
});

const expectSafeSvgRender = (container: HTMLElement) => {
  const img = container.querySelector('img');
  expect(img).not.toBeNull();
  expect(img!.getAttribute('src') || '').toMatch(/^data:image\/svg\+xml/);

  // No executable markup may reach the DOM.
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('[onload]')).toBeNull();
};

describe('SVG preview renders safely (no script execution)', () => {
  it('ViewerModal preview tab uses an <img> and never injects raw markup', () => {
    const { container } = render(
      <ViewerModal theme={theme} lang="es" file={makeSvgFile()} onClose={() => {}} onEdit={() => {}} />,
    );

    fireEvent.click(screen.getByText(/Previsualización/i));

    expectSafeSvgRender(container);
  });

  it('QuickViewPane uses an <img> and never injects raw markup', () => {
    const { container } = render(
      <QuickViewPane theme={theme} lang="es" targetItem={makeSvgFile()} onClose={() => {}} />,
    );

    expectSafeSvgRender(container);
  });

  it('HoverPreviewTooltip thumbnail uses an <img> and never injects raw markup', () => {
    const { container } = render(
      <HoverPreviewTooltip theme={theme} lang="es" item={makeSvgFile()} x={10} y={10} showThumbnail={true} />,
    );

    expectSafeSvgRender(container);
  });
});
