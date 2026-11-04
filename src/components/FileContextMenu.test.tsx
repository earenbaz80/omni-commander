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

  /** The tree lists absolute paths, so a pin that is not absolute never matches. */
  it('pins a folder by its absolute path', () => {
    expect(favoritePath(folder)).toBe('Users\\ana\\proyectos');
  });
});
