import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { FunctionKeyBar } from './FunctionKeyBar';
import { themes } from '../services/themeManager';
import { translations } from '../i18n/translations';
import { DiskTreeControls, setDiskTreeControls } from '../services/diskTreeControls';

const t = translations.es;

const renderBar = (fileActionsDisabled: boolean) => {
  const onCopy = vi.fn();
  const onMove = vi.fn();
  const onDelete = vi.fn();
  const onMkDir = vi.fn();
  const onView = vi.fn();
  const onEdit = vi.fn();
  const onOpenModal = vi.fn();
  render(
    <FunctionKeyBar
      theme={themes.classic_blue}
      lang="es"
      onOpenModal={onOpenModal}
      onCopy={onCopy}
      onMove={onMove}
      onDelete={onDelete}
      onMkDir={onMkDir}
      onView={onView}
      onEdit={onEdit}
      fileActionsDisabled={fileActionsDisabled}
    />,
  );
  const key = (label: string) =>
    document
      .querySelectorAll('button')
      .values()
      .toArray()
      .find((b) => b.textContent?.includes(label))!;
  return { key, onCopy, onDelete, onView, onOpenModal };
};

afterEach(() => {
  // Dropping the registration re-renders any bar still mounted.
  act(() => setDiskTreeControls(null));
});

const treeControls = (overrides: Partial<DiskTreeControls> = {}): DiskTreeControls => ({
  scanning: true,
  hasTree: true,
  following: false,
  stop: vi.fn(),
  expandAll: vi.fn(),
  collapseAll: vi.fn(),
  pin: vi.fn(),
  toggleFollow: vi.fn(),
  close: vi.fn(),
  ...overrides,
});

describe('FunctionKeyBar while the panel shows the size tree', () => {
  it('shows the tree commands instead of the file keys', () => {
    const controls = treeControls();
    act(() => setDiskTreeControls(controls));
    const { key } = renderBar(true);

    expect(key(t.diskScanStop).disabled).toBe(false);
    expect(key(t.diskKeyExpandAll).disabled).toBe(false);
    expect(key(t.diskKeyCollapseAll).disabled).toBe(false);
    expect(key(t.copyF5)).toBeUndefined();

    fireEvent.click(key(t.diskScanStop));
    fireEvent.click(key(t.diskKeyExpandAll));
    fireEvent.click(key(t.diskKeyCollapseAll));
    fireEvent.click(key(t.diskPanePin));
    fireEvent.click(key(t.diskPaneFollow));
    fireEvent.click(key(t.diskPaneClose));

    expect(controls.stop).toHaveBeenCalledTimes(1);
    expect(controls.expandAll).toHaveBeenCalledTimes(1);
    expect(controls.collapseAll).toHaveBeenCalledTimes(1);
    expect(controls.pin).toHaveBeenCalledTimes(1);
    expect(controls.toggleFollow).toHaveBeenCalledTimes(1);
    expect(controls.close).toHaveBeenCalledTimes(1);
  });

  it('greys out stop while nothing is scanning and expand while no tree exists', () => {
    act(() => setDiskTreeControls(treeControls({ scanning: false, hasTree: false })));
    const { key } = renderBar(true);

    expect(key(t.diskScanStop).disabled).toBe(true);
    expect(key(t.diskKeyExpandAll).disabled).toBe(true);
    expect(key(t.diskKeyCollapseAll).disabled).toBe(true);
    // Pin, follow and back always apply.
    expect(key(t.diskPanePin).disabled).toBe(false);
  });

  it('marks the follow key as engaged while the tree follows the other panel', () => {
    act(() => setDiskTreeControls(treeControls({ following: true })));
    const { key } = renderBar(true);

    expect(key(t.diskPaneFollow).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the file keys while the tree panel is not the active one', () => {
    act(() => setDiskTreeControls(treeControls()));
    const { key, onCopy } = renderBar(false);

    expect(key(t.copyF5).disabled).toBe(false);
    expect(key(t.diskScanStop)).toBeUndefined();

    fireEvent.click(key(t.copyF5));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});

describe('FunctionKeyBar with file actions disabled', () => {
  it('shows the file keys disabled and does not run their action', () => {
    const { key, onCopy, onDelete, onView } = renderBar(true);

    for (const label of [t.viewF3, t.editF4, t.copyF5, t.moveF6, t.mkdirF7, t.deleteF8]) {
      expect(key(label).disabled).toBe(true);
      expect(key(label).getAttribute('aria-disabled')).toBe('true');
      expect(key(label).title).toBe(t.fileActionsPaused);
    }

    fireEvent.click(key(t.copyF5));
    fireEvent.click(key(t.deleteF8));
    fireEvent.click(key(t.viewF3));

    expect(onCopy).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(onView).not.toHaveBeenCalled();
  });

  it('leaves the app-wide keys working', () => {
    const { key, onOpenModal } = renderBar(true);

    for (const label of [t.helpF1, t.menuF2, t.quitF10]) {
      expect(key(label).disabled).toBe(false);
    }

    fireEvent.click(key(t.helpF1));
    expect(onOpenModal).toHaveBeenCalledWith('help');
  });

  it('disables the alt-mode file keys but keeps the drive and search ones', async () => {
    const { key } = renderBar(true);

    fireEvent.keyDown(window, { key: 'Alt' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    for (const label of [t.fkeyAltHexView, t.fkeyAltEditDos, t.fkeyAltZipPack, t.fkeyAltUnzip]) {
      expect(key(label).disabled).toBe(true);
    }
    for (const label of [t.fkeyAltDriveL, t.fkeyAltFindGrep, t.fkeyAltExit]) {
      expect(key(label).disabled).toBe(false);
    }
  });

  it('keeps every key enabled when the panel shows its files', () => {
    const { key, onCopy } = renderBar(false);

    expect(key(t.copyF5).disabled).toBe(false);
    expect(key(t.copyF5).title).toBe('');

    fireEvent.click(key(t.copyF5));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
