import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { themes } from '../../services/themeManager';
import type { FileItem, RecycleBinItem } from '../../types';

const getRecycleBinItems = vi.fn();

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
    getRecycleBinItems: () => getRecycleBinItems(),
    restoreFromRecycleBin: vi.fn(),
    deletePermanentlyFromRecycleBin: vi.fn(),
    emptyRecycleBin: vi.fn(),
  },
}));

const { RecycleBinModal } = await import('./RecycleBinModal');

const file = (name: string, size: number): FileItem =>
  ({
    id: `${name}-${size}`,
    name,
    // The row appends the extension, so a name already carries it in these cases.
    ext: '',
    size,
    modifiedAt: '2026-01-01T10:00:00.000Z',
    isDirectory: false,
    attributes: { readOnly: false, hidden: false, system: false },
  }) as unknown as FileItem;

const binItem = (name: string, size: number): RecycleBinItem => ({
  id: `bin-${name}`,
  originalId: `${name}-${size}`,
  originalPath: `C:\\datos\\${name}`,
  originalDriveId: 'real_C',
  deletedAt: '2026-01-02T10:00:00.000Z',
  item: file(name, size),
});

const renderModal = (items: RecycleBinItem[]) => {
  getRecycleBinItems.mockReturnValue(items);
  render(<RecycleBinModal theme={themes.classic_blue} lang="es" onRefresh={vi.fn()} onClose={vi.fn()} />);
};

beforeEach(() => {
  getRecycleBinItems.mockReset();
});

/**
 * The bin lists whatever was deleted, including a large video or an image of a
 * virtual machine, so the size column has to reach gigabytes. It used to stop at
 * megabytes, which printed a 2 GiB entry as "2048.0 MB" while the same file read
 * "2.0 GB" in the listing and in its properties.
 */
describe('RecycleBinModal sizes', () => {
  it('keeps the small sizes in kilobytes', () => {
    renderModal([binItem('nota.txt', 1536)]);

    expect(screen.getByText('1.5 KB')).toBeTruthy();
    expect(screen.getByText('nota.txt')).toBeTruthy();
  });

  it('reads a file over a gigabyte in gigabytes, like the rest of the app', () => {
    renderModal([binItem('disco.img', 2 * 1024 ** 3)]);

    expect(screen.getByText('2.0 GB')).toBeTruthy();
    expect(screen.queryByText('2048.0 MB')).toBeNull();
  });
});
