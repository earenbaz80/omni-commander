import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../i18n/translations';
import { themes } from '../services/themeManager';
import { getDiskTreeControls } from '../services/diskTreeControls';
import type { DiskUsageScan } from '../types';

const getTreeSize = vi.fn();

vi.mock('../services/fileSystem', () => ({
  fsEngine: {
    isSystemDrive: () => true,
    getTreeSize: (...args: unknown[]) => getTreeSize(...args),
    getFolderSizes: () => null,
    files: [],
  },
}));

const { DiskUsagePane } = await import('./DiskUsagePane');

const t = translations.es;

/** Root -> hijo -> nieto, so "expand all" has two levels to open. */
const nestedScan = (): DiskUsageScan => ({
  path: 'C:\\datos',
  name: 'datos',
  sizeBytes: 4096,
  fileCount: 4,
  dirCount: 2,
  truncated: false,
  topFiles: [],
  subFolders: [
    {
      path: 'C:\\datos\\hijo',
      name: 'hijo',
      sizeBytes: 2048,
      fileCount: 2,
      dirCount: 1,
      truncated: false,
      topFiles: [],
      subFolders: [
        {
          path: 'C:\\datos\\hijo\\nieto',
          name: 'nieto',
          sizeBytes: 1024,
          fileCount: 1,
          dirCount: 0,
          truncated: false,
          topFiles: [],
          subFolders: [],
        },
      ],
    },
  ],
});

const scan = (path: string): DiskUsageScan => ({
  path,
  name: path.split('\\').pop() || path,
  sizeBytes: 2048,
  fileCount: 2,
  dirCount: 0,
  truncated: false,
  topFiles: [],
  subFolders: [],
});

const renderPane = (followPath: string, onClose = () => {}) =>
  render(
    <DiskUsagePane
      theme={themes.classic_blue}
      lang="es"
      followDriveId="real_C"
      followPath={followPath}
      onClose={onClose}
    />,
  );

const pane = (followPath: string, onClose = () => {}) => (
  <DiskUsagePane
    theme={themes.classic_blue}
    lang="es"
    followDriveId="real_C"
    followPath={followPath}
    onClose={onClose}
  />
);

beforeEach(() => {
  getTreeSize.mockReset();
  getTreeSize.mockImplementation((_drive: string, path: string) => Promise.resolve({ status: 'ok', tree: scan(path) }));
});

describe('DiskUsagePane', () => {
  it('measures the folder the other panel is showing, pinned from the start', async () => {
    renderPane('C:\\datos');

    await waitFor(() => expect(getTreeSize).toHaveBeenCalledTimes(1));
    expect(getTreeSize).toHaveBeenCalledWith('real_C', 'C:\\datos', expect.anything());
  });

  it('keeps measuring its pinned folder when the other panel navigates', async () => {
    const { rerender } = renderPane('C:\\datos');
    await waitFor(() => expect(getTreeSize).toHaveBeenCalledTimes(1));

    rerender(pane('C:\\otros'));

    expect(getTreeSize).toHaveBeenCalledTimes(1);
    expect(getTreeSize).toHaveBeenLastCalledWith('real_C', 'C:\\datos', expect.anything());
  });

  it('restarts on the new folder once following the other panel is on', async () => {
    const { rerender } = renderPane('C:\\datos');
    await waitFor(() => expect(getTreeSize).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTitle(t.diskPaneFollow));
    rerender(pane('C:\\otros'));

    await waitFor(() => expect(getTreeSize).toHaveBeenCalledTimes(2));
    expect(getTreeSize).toHaveBeenLastCalledWith('real_C', 'C:\\otros', expect.anything());
  });

  it('keeps the followed folder when following is switched off again', async () => {
    const { rerender } = renderPane('C:\\datos');
    await waitFor(() => expect(getTreeSize).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTitle(t.diskPaneFollow));
    rerender(pane('C:\\otros'));
    await waitFor(() => expect(getTreeSize).toHaveBeenCalledTimes(2));

    // Switching following off must not throw away the walk already in progress.
    fireEvent.click(screen.getByTitle(t.diskPaneFollow));
    rerender(pane('C:\\tercero'));

    expect(getTreeSize).toHaveBeenCalledTimes(2);
    expect(getTreeSize).toHaveBeenLastCalledWith('real_C', 'C:\\otros', expect.anything());
  });

  it('re-pins to the browsed folder and stops following', async () => {
    const { rerender } = renderPane('C:\\datos');
    await waitFor(() => expect(getTreeSize).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTitle(t.diskPaneFollow));
    rerender(pane('C:\\otros'));
    await waitFor(() => expect(getTreeSize).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByTitle(t.diskPanePin));
    rerender(pane('C:\\tercero'));

    // Still measuring the folder it was pinned to, not the new one.
    expect(getTreeSize).toHaveBeenCalledTimes(2);
    expect(getTreeSize).toHaveBeenLastCalledWith('real_C', 'C:\\otros', expect.anything());
  });

  it('returns to the file list through its close control', async () => {
    const onClose = vi.fn();
    renderPane('C:\\datos', onClose);
    await waitFor(() => expect(getTreeSize).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTitle(t.diskPaneClose));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('publishes its commands for the function-key bar while mounted', async () => {
    const onClose = vi.fn();
    const { unmount } = renderPane('C:\\datos', onClose);
    await waitFor(() => expect(getDiskTreeControls()).not.toBeNull());

    const controls = getDiskTreeControls()!;
    // The walk started by the mount is still running, so Stop applies.
    expect(controls.scanning).toBe(true);
    expect(controls.hasTree).toBe(false);

    act(() => controls.close());
    expect(onClose).toHaveBeenCalledTimes(1);

    // A panel that is gone must not leave commands behind for the bar.
    unmount();
    expect(getDiskTreeControls()).toBeNull();
  });

  it('opens every measured level through expand all and closes them again', async () => {
    getTreeSize.mockImplementation(() => Promise.resolve({ status: 'ok', tree: nestedScan() }));
    renderPane('C:\\datos');

    // First level is open by default, the next one is not.
    expect(await screen.findByText(/hijo/)).toBeDefined();
    expect(screen.queryByText(/nieto/)).toBeNull();

    await waitFor(() => expect(getDiskTreeControls()?.hasTree).toBe(true));
    act(() => getDiskTreeControls()!.expandAll());
    expect(await screen.findByText(/nieto/)).toBeDefined();

    act(() => getDiskTreeControls()!.collapseAll());
    await waitFor(() => expect(screen.queryByText(/nieto/)).toBeNull());
  });

  it('aborts the running walk when the bar asks it to stop', async () => {
    let signal: AbortSignal | undefined;
    getTreeSize.mockImplementation((_drive: string, _path: string, options: { signal?: AbortSignal }) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });

    renderPane('C:\\datos');
    await waitFor(() => expect(getDiskTreeControls()).not.toBeNull());

    act(() => getDiskTreeControls()!.stop());

    expect(signal?.aborted).toBe(true);
    expect(await screen.findByText(t.diskScanStopped)).toBeDefined();
  });
});
