import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import { themes } from '../../services/themeManager';
import type { DiskUsageScan, Drive } from '../../types';

const getTreeSize = vi.fn();

vi.mock('../../services/fileSystem', () => ({
  fsEngine: {
    // A real drive is the case that was broken: the modal has to ask the server
    // for measured sizes instead of reading its own listing index.
    isSystemDrive: () => true,
    getTreeSize: (...args: unknown[]) => getTreeSize(...args),
    getFolderSizes: () => null,
    getSearchIndex: () => [],
    files: [],
  },
}));

const { DiskUsageModal } = await import('./DiskUsageModal');

const t = translations.es;

const drives: Drive[] = [
  {
    id: 'real_C',
    letter: 'C:',
    name: 'Windows',
    isMounted: true,
    totalBytes: 100 * 1024 * 1024,
    freeBytes: 40 * 1024 * 1024,
  } as Drive,
];

const scan = (overrides: Partial<DiskUsageScan> = {}): DiskUsageScan => ({
  path: 'C:\\datos',
  name: 'datos',
  sizeBytes: 3072,
  fileCount: 4,
  dirCount: 1,
  truncated: false,
  topFiles: [{ path: 'C:\\datos', fullName: 'grande.bin', size: 2048 }],
  subFolders: [
    {
      path: 'C:\\datos\\proyectos',
      name: 'proyectos',
      sizeBytes: 1024,
      fileCount: 2,
      dirCount: 0,
      truncated: false,
      topFiles: [],
      subFolders: [],
    },
  ],
  ...overrides,
});

const renderModal = () =>
  render(
    <DiskUsageModal
      theme={themes.classic_blue}
      lang="es"
      drives={drives}
      driveId="real_C"
      // JSX string attributes do not process escapes: as a plain string this
      // would carry two backslashes and the scan would ask for a wrong path.
      rootPath={'C:\\datos'}
      onClose={() => {}}
    />,
  );

beforeEach(() => {
  getTreeSize.mockReset();
  getTreeSize.mockResolvedValue({ status: 'ok', tree: scan() });
});

describe('DiskUsageModal', () => {
  it('shows the measured size of the folder and of each subfolder', async () => {
    renderModal();

    expect(await screen.findByText(/3\.0 KB/)).toBeTruthy();
    expect(screen.getByText(/proyectos/)).toBeTruthy();
    expect(screen.getByText(/1\.0 KB/)).toBeTruthy();
    expect(getTreeSize).toHaveBeenCalledWith(
      'real_C',
      'C:\\datos',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('lists the largest files the scan found, with their real size', async () => {
    renderModal();

    expect(await screen.findByText('grande.bin')).toBeTruthy();
    expect(screen.getByText('2.0 KB')).toBeTruthy();
  });

  it('warns when part of the tree could not be measured', async () => {
    getTreeSize.mockResolvedValue({ status: 'ok', tree: scan({ truncated: true }) });
    renderModal();

    expect(await screen.findByText(t.diskScanTruncated)).toBeTruthy();
  });

  it('shows the scan as it runs and stops it on demand', async () => {
    let options: { signal?: AbortSignal; onProgress?: (p: unknown) => void } = {};
    getTreeSize.mockImplementation((_drive: string, _path: string, opts: typeof options) => {
      options = opts;
      opts.onProgress?.({
        // No thousands separator: the locale's space would not survive the
        // text matcher's whitespace normalisation below.
        entries: 123,
        files: 100,
        dirs: 23,
        bytes: 0,
        currentPath: 'C:\\datos\\fotos',
        elapsedMs: 900,
        folders: [{ path: 'C:\\datos\\proyectos', name: 'proyectos', sizeBytes: 1024, fileCount: 2 }],
      });
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    renderModal();

    const expected = t.diskScanProgress.replace('{n}', '123').replace('{size}', '0 B');
    expect(await screen.findByText(expected)).toBeTruthy();
    // A finished root folder is listed before the whole answer exists.
    expect(screen.getByText(/proyectos/)).toBeTruthy();

    fireEvent.click(screen.getByText(t.diskScanStop));

    expect(options.signal?.aborted).toBe(true);
    expect(await screen.findByText(t.diskScanStopped)).toBeTruthy();
  });

  it('reports a dead server instead of showing an empty tree', async () => {
    getTreeSize.mockResolvedValue({ status: 'failed', reason: 'unreachable' });
    renderModal();

    await waitFor(() => expect(screen.getByText(t.diskScanFailed)).toBeTruthy());
    expect(screen.queryByText(t.diskUsageNoData)).toBeNull();
  });

  it('blames permissions, not the server, when the folder is closed to this account', async () => {
    getTreeSize.mockResolvedValue({ status: 'failed', reason: 'forbidden' });
    renderModal();

    expect(await screen.findByText(t.diskScanForbidden)).toBeTruthy();
    expect(screen.queryByText(t.diskScanFailed)).toBeNull();
  });

  it('says the folder is gone when it disappeared mid-scan', async () => {
    getTreeSize.mockResolvedValue({ status: 'failed', reason: 'notFound' });
    renderModal();

    expect(await screen.findByText(t.diskScanNotFound)).toBeTruthy();
    expect(screen.queryByText(t.diskScanFailed)).toBeNull();
  });
});
