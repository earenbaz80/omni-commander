import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FreeSpaceModal } from './FreeSpaceModal';
import { themes } from '../../services/themeManager';
import { FreeSpaceVolume } from '../../types';

/**
 * The window only appears when a transfer does not fit, and its whole job is to
 * show honest numbers before the disk decides for the user. Force has to be an
 * explicit click: nothing else may start the copy.
 */

const volumes: FreeSpaceVolume[] = [
  { volume: 'C:\\', size: 5 * 1024 ** 3, free: 2 * 1024 ** 3, lacking: 3 * 1024 ** 3 },
  { volume: 'D:\\', size: 1024, free: null, lacking: 0 },
];

const renderModal = (list: FreeSpaceVolume[] = volumes) => {
  const onForce = vi.fn();
  const onCancel = vi.fn();
  render(<FreeSpaceModal volumes={list} theme={themes.classic_blue} lang="en" onForce={onForce} onCancel={onCancel} />);
  return { onForce, onCancel };
};

describe('FreeSpaceModal', () => {
  it('shows what each volume needs, has and misses', () => {
    renderModal();

    expect(screen.getByText('Not enough free space')).toBeTruthy();
    expect(screen.getByText('C:\\')).toBeTruthy();
    expect(screen.getByText('5.0 GB')).toBeTruthy();
    expect(screen.getByText('2.0 GB')).toBeTruthy();
    expect(screen.getByText('3.0 GB')).toBeTruthy();
  });

  it('does not pretend an unreadable volume has no free space', () => {
    renderModal();

    // A volume that could not be read shows "—" instead of a misleading 0 B.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('1.0 KB')).toBeTruthy();
  });

  it('marca el tamaño como mínimo cuando el pre-flight no midió todo', () => {
    const { container } = render(
      <FreeSpaceModal
        volumes={[{ volume: 'C:\\', size: 1024, free: 512, lacking: 512, complete: false }]}
        theme={themes.classic_blue}
        lang="en"
        onForce={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // A lower bound must not be read as the total the copy will write.
    expect(container.textContent).toContain('≥ 1.0 KB');
  });

  it('starts the copy only when the user forces it', () => {
    const { onForce, onCancel } = renderModal();

    expect(onForce).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Force copy' }));

    expect(onForce).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels without starting anything', () => {
    const { onForce, onCancel } = renderModal();

    // The header cross shares the label with the footer button.
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[1]);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onForce).not.toHaveBeenCalled();
  });
});
