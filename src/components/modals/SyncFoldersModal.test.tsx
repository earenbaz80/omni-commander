import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import { themes } from '../../services/themeManager';
import type { FileItem } from '../../types';

const transferPaths = vi.fn();
const loadSystemDriveDirectory = vi.fn();
const copyItem = vi.fn();
const isRealFile = vi.fn();
const absolutePathOf = vi.fn();

vi.mock('../../services/soundEffects', () => ({
  soundManager: {
    playKeyTick: vi.fn(),
    playDiskAccess: vi.fn(),
    playSuccess: vi.fn(),
    playSelectSound: vi.fn(),
    playError: vi.fn(),
    playBeep: vi.fn(),
  },
}));

vi.mock('../../services/fileSystem', () => ({
  fsEngine: {
    isRealFile: (item: FileItem) => isRealFile(item),
    transferPaths: (...args: unknown[]) => transferPaths(...args),
    loadSystemDriveDirectory: (...args: unknown[]) => loadSystemDriveDirectory(...args),
    copyItem: (...args: unknown[]) => copyItem(...args),
    absolutePathOf: (item: FileItem) => absolutePathOf(item),
  },
}));

const { SyncFoldersModal } = await import('./SyncFoldersModal');

const t = translations.es;
const onClose = vi.fn();
const onSyncComplete = vi.fn();
const alertMock = vi.fn();

const file = (name: string, size: number, modifiedAt = '2026-01-01T10:00:00.000Z'): FileItem =>
  ({
    id: `${name}-${size}`,
    name,
    ext: 'txt',
    size,
    modifiedAt,
    isDirectory: false,
    attributes: { readOnly: false, hidden: false, system: false },
  }) as unknown as FileItem;

const renderModal = (leftItems: FileItem[], rightItems: FileItem[]) =>
  render(
    <SyncFoldersModal
      theme={themes.classic_blue}
      lang="es"
      leftDriveId="real_C"
      leftPath={'C:\\izq'}
      leftItems={leftItems}
      rightDriveId="real_D"
      rightPath={'D:\\der'}
      rightItems={rightItems}
      onSyncComplete={onSyncComplete}
      onClose={onClose}
    />,
  );

const row = (name: string) => document.querySelector(`[data-sync-name="${name}"]`);

beforeEach(() => {
  vi.stubGlobal('alert', alertMock);
  alertMock.mockReset();
  onClose.mockReset();
  onSyncComplete.mockReset();
  transferPaths.mockReset();
  loadSystemDriveDirectory.mockReset();
  copyItem.mockReset();
  absolutePathOf.mockReset();
  absolutePathOf.mockImplementation((item: FileItem) => `C:\\izq\\${item.name}.txt`);
  isRealFile.mockReset();
  isRealFile.mockReturnValue(true);
  transferPaths.mockResolvedValue(undefined);
  loadSystemDriveDirectory.mockResolvedValue(undefined);
});

describe('SyncFoldersModal diff', () => {
  /**
   * The diff compares folders, so an image or a virtual disk is a normal entry.
   * The column stopped at megabytes, which printed a 2 GiB file as "2048.0 MB"
   * while the panels showed it as "2.0 GB".
   */
  it('reads a file over a gigabyte in gigabytes, like the rest of the app', () => {
    renderModal([file('disco.img', 2 * 1024 ** 3)], []);

    expect(row('disco.img')?.textContent).toContain('2.0 GB');
    expect(row('disco.img')?.textContent).not.toContain('2048.0 MB');
  });

  it('classifies each name once, by size before date', () => {
    renderModal(
      [file('solo-izq', 10), file('distinto', 20), file('izq-nuevo', 50, '2026-03-01T10:00:00.000Z')],
      [file('distinto', 30), file('solo-der', 5), file('izq-nuevo', 50, '2026-02-01T10:00:00.000Z')],
    );

    // A name that only one side has is a copy in one direction, not a conflict.
    expect(row('solo-izq')?.getAttribute('data-sync-status')).toBe('LEFT_ONLY');
    expect(row('solo-izq')?.getAttribute('data-sync-direction')).toBe('L_TO_R');
    expect(row('solo-der')?.getAttribute('data-sync-status')).toBe('RIGHT_ONLY');
    expect(row('solo-der')?.getAttribute('data-sync-direction')).toBe('R_TO_L');

    // Different sizes win over dates: the smaller copy is the one replaced.
    expect(row('distinto')?.getAttribute('data-sync-status')).toBe('SIZE_MISMATCH');
    expect(row('distinto')?.getAttribute('data-sync-direction')).toBe('R_TO_L');

    expect(row('izq-nuevo')?.getAttribute('data-sync-status')).toBe('LEFT_NEWER');
    expect(row('izq-nuevo')?.getAttribute('data-sync-direction')).toBe('L_TO_R');
  });

  it('hides the identical files until asked, and counts what each direction will do', () => {
    renderModal([file('igual', 10), file('solo-izq', 10)], [file('igual', 10)]);

    expect(row('igual')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: t.syncHideEqual }));

    expect(row('igual')?.getAttribute('data-sync-status')).toBe('EQUAL');
    expect(row('igual')?.getAttribute('data-sync-direction')).toBe('SKIP');
    expect(screen.getByText(/A → B: 1/)).toBeTruthy();
    expect(screen.getByText(/B → A: 0/)).toBeTruthy();
    expect(screen.getByText(t.syncSkipped.replace('{n}', '1'))).toBeTruthy();
  });

  it('says the folders are already in sync instead of showing an empty table', () => {
    renderModal([file('igual', 10)], [file('igual', 10)]);

    expect(screen.getByText(t.syncInSync)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('SyncFoldersModal directions', () => {
  it('cycles one row through the three directions and back', () => {
    renderModal([file('solo-izq', 10)], []);
    const button = () => row('solo-izq')!.querySelector('button')!;

    expect(row('solo-izq')?.getAttribute('data-sync-direction')).toBe('L_TO_R');
    fireEvent.click(button());
    expect(row('solo-izq')?.getAttribute('data-sync-direction')).toBe('R_TO_L');
    fireEvent.click(button());
    expect(row('solo-izq')?.getAttribute('data-sync-direction')).toBe('SKIP');
    fireEvent.click(button());
    expect(row('solo-izq')?.getAttribute('data-sync-direction')).toBe('L_TO_R');
  });

  it('leaves the status alone when the direction changes: only the action moves', () => {
    renderModal([file('solo-izq', 10)], []);

    fireEvent.click(row('solo-izq')!.querySelector('button')!);

    expect(row('solo-izq')?.getAttribute('data-sync-status')).toBe('LEFT_ONLY');
  });

  it('applies one direction to everything, or the smart one', () => {
    renderModal([file('solo-izq', 10), file('distinto', 20)], [file('distinto', 30)]);

    fireEvent.click(screen.getByText(t.syncCopyAllBA));
    expect(row('solo-izq')?.getAttribute('data-sync-direction')).toBe('R_TO_L');
    expect(row('distinto')?.getAttribute('data-sync-direction')).toBe('R_TO_L');

    fireEvent.click(screen.getByText(t.syncSkipAll));
    expect(row('solo-izq')?.getAttribute('data-sync-direction')).toBe('SKIP');

    fireEvent.click(screen.getByRole('button', { name: /Auto Smart Sync/ }));
    // Smart sync follows the status, so the mismatch goes back to skipping.
    expect(row('solo-izq')?.getAttribute('data-sync-direction')).toBe('L_TO_R');
    expect(row('distinto')?.getAttribute('data-sync-direction')).toBe('SKIP');
  });
});

describe('SyncFoldersModal run', () => {
  it('refuses to start with nothing marked', () => {
    renderModal([file('igual', 10)], [file('igual', 10)]);

    fireEvent.click(screen.getByText(t.syncExecute));

    expect(alertMock).toHaveBeenCalledWith(t.syncNoMarked);
    expect(transferPaths).not.toHaveBeenCalled();
  });

  it('copies a real file by its path and reloads the panel that received it', async () => {
    renderModal([file('solo-izq', 10)], []);

    fireEvent.click(screen.getByText(t.syncExecute));

    await waitFor(() => expect(onSyncComplete).toHaveBeenCalled());
    expect(transferPaths).toHaveBeenCalledWith('copy', ['C:\\izq\\solo-izq.txt'], 'D:\\der', true);
    expect(loadSystemDriveDirectory).toHaveBeenCalledWith('real_D', 'D:\\der');
    expect(copyItem).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('falls back to the catalogue id for entries with no disk path', async () => {
    isRealFile.mockReturnValue(false);
    copyItem.mockResolvedValue(true);
    renderModal([], [file('solo-der', 10)]);

    fireEvent.click(screen.getByText(t.syncExecute));

    await waitFor(() => expect(copyItem).toHaveBeenCalled());
    expect(copyItem).toHaveBeenCalledWith('solo-der-10', 'real_C', 'C:\\izq', true);
    expect(transferPaths).not.toHaveBeenCalled();
  });

  it('reports the file that failed instead of closing as if it worked', async () => {
    transferPaths.mockRejectedValue(new Error('disco lleno'));
    renderModal([file('solo-izq', 10)], []);

    fireEvent.click(screen.getByText(t.syncExecute));

    await waitFor(() => expect(alertMock).toHaveBeenCalled());
    expect(alertMock).toHaveBeenCalledWith(t.syncError.replace('{error}', 'disco lleno'));
    expect(onSyncComplete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // The button is usable again, so a second run is possible.
    await waitFor(() => expect(screen.getByText(t.syncExecute)).toBeTruthy());
  });
});
