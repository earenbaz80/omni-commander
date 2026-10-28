import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ZipArchiveModal } from './ZipArchiveModal';
import { themes } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { FileItem } from '../../types';

const t = getTranslations('es');

const item = (name: string, ext: string): FileItem => ({
  id: `${name}.${ext}`,
  name,
  ext,
  isDirectory: false,
  size: 1024,
  path: 'C:',
  driveId: 'real_C',
  modifiedAt: '2026-01-01 10:00',
  createdAt: '2026-01-01 10:00',
  attributes: { readOnly: false, hidden: false, system: false, archive: true },
  content: '',
});

const baseProps = {
  theme: themes.classic_blue,
  lang: 'es' as const,
  targetDriveId: 'real_C',
  targetPath: 'C:',
  onCompress: vi.fn(),
  onExtract: vi.fn(),
  onClose: vi.fn(),
};

const formatButtons = (container: HTMLElement) =>
  [...container.querySelectorAll('button')]
    .map((button) => button.textContent?.trim() ?? '')
    .filter((label) => label.startsWith('.'));

describe('ZipArchiveModal format promises', () => {
  it('offers exactly the formats the engine can write', () => {
    const { container } = render(<ZipArchiveModal {...baseProps} selectedItems={[item('documento', 'txt')]} />);
    expect(formatButtons(container)).toEqual(['.zip', '.tar', '.tar.gz']);
  });

  it('creates the archive with the extension of the chosen format', () => {
    const onCompress = vi.fn();
    const { container, getByText } = render(
      <ZipArchiveModal {...baseProps} onCompress={onCompress} selectedItems={[item('documento', 'txt')]} />,
    );

    fireEvent.click(getByText('.tar.gz'));
    fireEvent.click(getByText(t.zipCreateBtn.replace('{format}', 'tar.gz')));

    // The name handed to the engine already ends in the chosen extension, so it
    // cannot be written as a ZIP named `.tar.gz` as it used to be.
    expect(onCompress).toHaveBeenCalledWith('documento.tar.gz', 'TAR.GZ');
    expect(container.textContent).toContain('documento.tar.gz');
  });

  it('offers to extract a RAR, which the local server reads', () => {
    const { getByText } = render(<ZipArchiveModal {...baseProps} selectedItems={[item('pelicula', 'rar')]} />);
    // The window opens straight into extraction, so no "cannot be opened" note
    // is shown for a format that has a reader behind it.
    expect(getByText(t.zipExtractMode)).toBeTruthy();
    expect(getByText(t.zipExtractMode).className).toContain('bg-amber-400');
  });

  it('keeps extracting available for a format with a reader', () => {
    const { getByText } = render(<ZipArchiveModal {...baseProps} selectedItems={[item('copia', 'zip')]} />);
    expect(getByText(t.zipExtractMode)).toBeTruthy();
  });
});
