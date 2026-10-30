import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TreeNavigationPane } from './TreeNavigationPane';
import { themes } from '../services/themeManager';
import { fsEngine } from '../services/fileSystem';
import { loadUserFolders } from '../services/userFolders';
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

const renderPane = (
  props: Partial<React.ComponentProps<typeof TreeNavigationPane>> = {},
  // What the server answers about the pinned folders; null means it did not answer.
  missing: string[] | null = [],
) => {
  const onNavigate = vi.fn();
  const onSelectDrive = vi.fn();
  vi.spyOn(fsEngine, 'getFiles').mockImplementation((_driveId, path) => listings[path] ?? []);
  const missingFolders = vi.spyOn(fsEngine, 'missingFolders').mockResolvedValue(missing);
  render(
    <TreeNavigationPane
      theme={themes.classic_blue}
      lang="es"
      drives={drives}
      currentPath="C:\\"
      currentDriveId="real_C"
      onNavigate={onNavigate}
      onSelectDrive={onSelectDrive}
      {...props}
    />,
  );
  return { onNavigate, onSelectDrive, missingFolders };
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

  /**
   * A pane can mount before the local server is listening. The first lookup then
   * fails, so the arrival of the drives — the same server answering — has to make
   * the pane ask again instead of staying empty for the session.
   */
  it('asks again when the drives arrive after a first empty lookup', async () => {
    const mocked = vi.mocked(loadUserFolders);
    mocked.mockResolvedValueOnce([]);
    vi.spyOn(fsEngine, 'getFiles').mockReturnValue([]);
    const props = {
      theme: themes.classic_blue,
      lang: 'es' as const,
      currentPath: 'C:\\',
      currentDriveId: 'real_C',
      onNavigate: vi.fn(),
      onSelectDrive: vi.fn(),
    };
    const { rerender } = render(<TreeNavigationPane {...props} drives={[]} />);

    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Escritorio')).toBeNull();

    rerender(<TreeNavigationPane {...props} drives={drives} />);

    expect(await screen.findByText('Escritorio')).toBeTruthy();
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it('opens a library in the active panel when it is clicked', async () => {
    const { onNavigate, onSelectDrive } = renderPane();

    fireEvent.click(await screen.findByText('Documentos'));

    expect(onSelectDrive).toHaveBeenCalledWith('real_C');
    expect(onNavigate).toHaveBeenCalledWith(documentsPath);
  });
});

describe('TreeNavigationPane favorites', () => {
  const projects = 'C:\\Users\\ana\\proyectos';

  it('lists a pinned folder above the libraries, by its last segment', async () => {
    renderPane({ favoriteFolders: [projects] });

    expect(await screen.findByText('Favoritos')).toBeTruthy();
    expect(screen.getByText('proyectos')).toBeTruthy();
  });

  it('shows no favorites section at all when nothing is pinned', async () => {
    renderPane({ favoriteFolders: [] });

    await screen.findByText('Escritorio');
    expect(screen.queryByText('Favoritos')).toBeNull();
  });

  it('skips a pinned folder whose drive is gone', async () => {
    renderPane({ favoriteFolders: ['D:\\Archivo viejo'] });

    await screen.findByText('Escritorio');
    expect(screen.queryByText('Archivo viejo')).toBeNull();
  });

  it('opens the pinned folder in the panel when it is clicked', async () => {
    const { onNavigate, onSelectDrive } = renderPane({ favoriteFolders: [projects] });

    fireEvent.click(await screen.findByText('proyectos'));

    expect(onSelectDrive).toHaveBeenCalledWith('real_C');
    expect(onNavigate).toHaveBeenCalledWith(projects);
  });

  it('drops a pinned folder deleted outside the app, and says which one', async () => {
    const onMissingFavorites = vi.fn();
    renderPane({ favoriteFolders: [projects], onMissingFavorites }, [projects]);

    await waitFor(() => expect(onMissingFavorites).toHaveBeenCalledWith([projects]));
    expect(screen.queryByText('proyectos')).toBeNull();
  });

  it('keeps the pinned folder that is still there', async () => {
    const other = 'C:\\Users\\ana\\otra';
    const onMissingFavorites = vi.fn();
    renderPane({ favoriteFolders: [projects, other], onMissingFavorites }, [projects]);

    await waitFor(() => expect(onMissingFavorites).toHaveBeenCalledWith([projects]));
    expect(screen.getByText('otra')).toBeTruthy();
    expect(screen.queryByText('proyectos')).toBeNull();
  });

  it('prunes nothing when the server cannot answer', async () => {
    const onMissingFavorites = vi.fn();
    renderPane({ favoriteFolders: [projects], onMissingFavorites }, null);

    expect(await screen.findByText('proyectos')).toBeTruthy();
    expect(onMissingFavorites).not.toHaveBeenCalled();
  });

  it('never asks about a pinned folder on an unmounted drive', async () => {
    const { missingFolders } = renderPane({ favoriteFolders: ['D:\\Archivo viejo'] });

    await screen.findByText('Escritorio');
    expect(missingFolders).not.toHaveBeenCalled();
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
