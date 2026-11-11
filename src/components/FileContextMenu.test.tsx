import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FileContextMenu, favoritePath, type FileContextMenuProps } from './FileContextMenu';
import { themes } from '../services/themeManager';
import { FileItem, PanelTab, UserSettings } from '../types';

// The wrapper asks the engine what the target allows while it renders; these
// tests are about the wiring, not about a real disk.
vi.mock('../services/fileSystem', () => ({
  fsEngine: {
    isRealFile: () => true,
    isSystemDrive: () => true,
    openWithPrograms: () => Promise.resolve([]),
    openWith: () => Promise.resolve(true),
    openWithProgram: () => Promise.resolve(true),
    sendTo: () => Promise.resolve(true),
    importBrowserFile: () => Promise.resolve(),
    lastServerError: '',
  },
}));

const file: FileItem = {
  id: 'f1',
  name: 'informe',
  ext: 'TXT',
  fullName: 'informe.txt',
  isDirectory: false,
  size: 12,
  path: 'Users\\ana',
  driveId: 'real_C',
  modifiedAt: '2026-01-01 10:00',
  createdAt: '2026-01-01 10:00',
  attributes: { readOnly: false, hidden: false, system: false, archive: true },
  content: '',
};

const folder: FileItem = { ...file, id: 'd1', name: 'proyectos', ext: '', fullName: 'proyectos', isDirectory: true };

const archive: FileItem = { ...file, id: 'z1', name: 'respaldo', ext: 'ZIP', fullName: 'respaldo.zip' };

const tab = (driveId: string, currentPath: string) => ({ driveId, currentPath }) as unknown as PanelTab;

const buildProps = (overrides: Partial<FileContextMenuProps> = {}): FileContextMenuProps => ({
  theme: themes.classic_blue,
  lang: 'es',
  state: { visible: true, x: 10, y: 10, targetItem: file, panelSide: 'left' },
  settings: { favoriteFolders: [] } as unknown as UserSettings,
  currentActiveTab: tab('real_C', 'Users\\ana'),
  leftTab: tab('real_C', 'Users\\ana'),
  rightTab: tab('real_D', 'D:\\'),
  onClose: vi.fn(),
  setSelectedFileForModal: vi.fn(),
  setActiveModal: vi.fn(),
  setModalData: vi.fn(),
  setSettings: vi.fn(),
  onCopy: vi.fn(),
  onMove: vi.fn(),
  onDelete: vi.fn(),
  onRefresh: vi.fn(),
  onShowConsole: vi.fn(),
  onExecuteCommand: vi.fn().mockResolvedValue(undefined),
  onExtract: vi.fn(),
  ...overrides,
});

describe('FileContextMenu', () => {
  it('renders nothing while it is closed', () => {
    const props = buildProps({ state: { visible: false, x: 0, y: 0, targetItem: null, panelSide: 'left' } });
    const { container } = render(<FileContextMenu {...props} />);
    expect(container.firstChild).toBeNull();
  });

  /** The target comes from the state snapshot, not from a live selection. */
  it('hands the target it was opened over to the tool it opens', () => {
    const props = buildProps();
    render(<FileContextMenu {...props} />);

    fireEvent.click(screen.getByText('Renombrar'));

    expect(props.setSelectedFileForModal).toHaveBeenCalledWith(file);
    expect(props.setActiveModal).toHaveBeenCalledWith('rename');
  });

  /** The menu names the destination; the engine no longer picks the pane alone. */
  it('extracts into the folder the archive lives in', () => {
    const onExtract = vi.fn();
    const props = buildProps({
      state: { visible: true, x: 10, y: 10, targetItem: archive, panelSide: 'left' },
      onExtract,
    });
    render(<FileContextMenu {...props} />);

    fireEvent.click(screen.getByText('Extraer'));
    fireEvent.click(screen.getByText('Extraer aquí'));

    expect(onExtract).toHaveBeenCalledWith(archive, { driveId: 'real_C', path: 'Users\\ana' });
  });

  it('extracts into the other pane when that is the destination chosen', () => {
    const onExtract = vi.fn();
    const props = buildProps({
      state: { visible: true, x: 10, y: 10, targetItem: archive, panelSide: 'left' },
      onExtract,
    });
    render(<FileContextMenu {...props} />);

    fireEvent.click(screen.getByText('Extraer'));
    fireEvent.click(screen.getByText('Extraer en el otro panel'));

    expect(onExtract).toHaveBeenCalledWith(archive, { driveId: 'real_D', path: 'D:\\' });
  });

  /** The tree lists absolute paths, so a pin that is not absolute never matches. */
  it('pins a folder by its absolute path', () => {
    expect(favoritePath(folder)).toBe('Users\\ana\\proyectos');
  });

  /** Sharing a folder from the menu targets that folder, not the panel it sits in. */
  it('shares the folder the menu was opened over', () => {
    const props = buildProps({ state: { visible: true, x: 10, y: 10, targetItem: folder, panelSide: 'left' } });
    render(<FileContextMenu {...props} />);

    fireEvent.click(screen.getByText('Compartir en red…'));

    expect(props.setModalData).toHaveBeenCalledWith({ shareFolderPath: 'Users\\ana\\proyectos' });
    expect(props.setActiveModal).toHaveBeenCalledWith('share');
  });

  /** A drive root already ends in a separator; the share path must not add another. */
  it('shares a folder at a drive root without doubling the separator', () => {
    const atRoot: FileItem = { ...folder, path: 'C:\\' };
    const props = buildProps({ state: { visible: true, x: 10, y: 10, targetItem: atRoot, panelSide: 'left' } });
    render(<FileContextMenu {...props} />);

    fireEvent.click(screen.getByText('Compartir en red…'));

    expect(props.setModalData).toHaveBeenCalledWith({ shareFolderPath: 'C:\\proyectos' });
  });

  /** A file is not a folder to serve, so the entry is not offered on one. */
  it('does not offer the network share for a file', () => {
    render(<FileContextMenu {...buildProps()} />);

    expect(screen.queryByText('Compartir en red…')).toBeNull();
  });
});
