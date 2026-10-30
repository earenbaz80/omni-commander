import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TreeNavigationPane } from './TreeNavigationPane';
import { themes } from '../services/themeManager';
import { fsEngine } from '../services/fileSystem';
import { Drive, FileItem } from '../types';

/**
 * The pane's first section used to be an empty array, so "Quick Access" rendered
 * a header with nothing under it. It now shows the Windows libraries the server
 * resolves, and a double click on a directory opens or closes it in place.
 */
const desktopPath = 'C:\\Users\\ana\\Desktop';
const documentsPath = 'C:\\Users\\ana\\Documents';

vi.mock('../services/userFolders', () => ({
  loadUserFolders: vi.fn(async () => [
    { key: 'desktop', path: 'C:\\Users\\ana\\Desktop' },
    { key: 'documents', path: 'C:\\Users\\ana\\Documents' },
    // Its drive is not mounted in this test, so it must not be offered.
    { key: 'music', path: 'D:\\Musica' },
  ]),
}));

const drive = (id: string, letter: string, isMounted = true): Drive => ({
  id,
  letter,
  name: letter,
  type: 'local',
  totalBytes: 100,
  freeBytes: 50,
  isMounted,
});

const drives: Drive[] = [drive('real_C', 'C:'), drive('real_D', 'D:', false)];

const folder = (name: string, path: string, driveId: string): FileItem => ({
  id: `${driveId}_${name}`,
  name,
  ext: '',
  fullName: name,
  path,
  driveId,
  isDirectory: true,
  size: 0,
  modifiedAt: '2026-10-20 10:00',
  createdAt: '2026-10-20 10:00',
  attributes: { readOnly: false, hidden: false, system: false, archive: false },
  content: '',
});

/** Only the desktop has subfolders; everything else is an empty listing. */
const listings: Record<string, FileItem[]> = {
  [desktopPath]: [folder('proyectos', `${desktopPath}\\proyectos`, 'real_C')],
};

const renderPane = () => {
  const onNavigate = vi.fn();
  const onSelectDrive = vi.fn();
  vi.spyOn(fsEngine, 'getFiles').mockImplementation((_driveId, path) => listings[path] ?? []);
  render(
    <TreeNavigationPane
      theme={themes.classic_blue}
      lang="es"
      drives={drives}
      currentPath="C:\\"
      currentDriveId="real_C"
      onNavigate={onNavigate}
      onSelectDrive={onSelectDrive}
    />,
  );
  return { onNavigate, onSelectDrive };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TreeNavigationPane libraries', () => {
  it('shows the user folders the server resolved', async () => {
    renderPane();

    expect(await screen.findByText('Escritorio')).toBeTruthy();
    expect(screen.getByText('Documentos')).toBeTruthy();
  });

  it('hides a library whose drive is not mounted', async () => {
    renderPane();

    await screen.findByText('Escritorio');
    // Música lives on D:, which this machine does not have mounted.
    expect(screen.queryByText('Música')).toBeNull();
  });

  it('opens a library in the active panel when it is clicked', async () => {
    const { onNavigate, onSelectDrive } = renderPane();

    fireEvent.click(await screen.findByText('Documentos'));

    expect(onSelectDrive).toHaveBeenCalledWith('real_C');
    expect(onNavigate).toHaveBeenCalledWith(documentsPath);
  });
});

describe('TreeNavigationPane double click', () => {
  it('expands a directory in place and collapses it again', async () => {
    renderPane();

    const desktop = await screen.findByText('Escritorio');
    expect(screen.queryByText('proyectos')).toBeNull();

    fireEvent.doubleClick(desktop);
    expect(await screen.findByText('proyectos')).toBeTruthy();

    fireEvent.doubleClick(desktop);
    await waitFor(() => expect(screen.queryByText('proyectos')).toBeNull());
  });

  it('expands a drive root as well, which is the same gesture one level up', async () => {
    renderPane();

    const driveRow = await screen.findByText('[C:]');
    expect(screen.queryByText('proyectos')).toBeNull();

    fireEvent.doubleClick(driveRow);
    // The drive root listing is empty in this fixture, so the branch states it.
    expect(await screen.findByText('(disco vacío)')).toBeTruthy();
  });
});
