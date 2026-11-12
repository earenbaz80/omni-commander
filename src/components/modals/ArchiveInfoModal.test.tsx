import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { themes } from '../../services/themeManager';
import { ArchiveInfoModal } from './ArchiveInfoModal';

const renderModal = (fileSize: number) =>
  render(
    <ArchiveInfoModal
      theme={themes.classic_blue}
      lang="es"
      fileName="respaldo.zip"
      fileSize={fileSize}
      fileDate={new Date('2026-01-02T10:00:00.000Z')}
      onExtractAll={vi.fn()}
      onClose={vi.fn()}
    />,
  );

/**
 * The window measured everything in megabytes, so a small archive read
 * "0.00 MB". The size now picks its unit, as it does everywhere else.
 */
describe('ArchiveInfoModal size', () => {
  it('reads a small archive in kilobytes', () => {
    renderModal(3 * 1024);

    expect(screen.getByText('3.0 KB')).toBeTruthy();
    expect(screen.queryByText('0.00 MB')).toBeNull();
  });

  it('reads an archive of several megabytes in megabytes', () => {
    renderModal(12.5 * 1024 * 1024);

    expect(screen.getByText('12.5 MB')).toBeTruthy();
  });
});
