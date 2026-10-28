import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ChooseFolderModal } from './ChooseFolderModal';
import { themes } from '../../services/themeManager';
import { translations } from '../../i18n/translations';
import { fsEngine } from '../../services/fileSystem';
import { Drive, FileItem } from '../../types';

const t = translations.es;

const drive = (id: string, letter: string, isMounted = true): Drive => ({
  id,
  letter,
  name: letter,
  type: 'local',
  totalBytes: 100,
  freeBytes: 50,
  isMounted,
});

const drives: Drive[] = [
  drive('real_C', 'C:'),
  drive('real_D', 'D:'),
  drive('real_E', 'E:', false),
  drive('vfs', 'V:'),
];

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

/** Drives the server can read; anything else answers "no such folder". */
const listings: Record<string, FileItem[]> = {
  'C:\\Temp': [folder('Escritorio', 'C:\\Temp', 'real_C')],
  'D:': [folder('Proyectos', 'D:', 'real_D')],
  'D:\\Proyectos': [],
  // A remembered destination that was deleted after the copy that recorded it.
  'D:\\Borrada': undefined as unknown as FileItem[],
};

const renderPicker = (props: Partial<React.ComponentProps<typeof ChooseFolderModal>> = {}) => {
  const onConfirm = props.onConfirm ?? vi.fn();
  vi.spyOn(fsEngine, 'loadSystemDriveDirectory').mockImplementation(async (_driveId, path) =>
    Array.isArray(listings[path]),
  );
  vi.spyOn(fsEngine, 'getFiles').mockImplementation((_driveId, path) => listings[path] ?? []);
  render(
    <ChooseFolderModal
      theme={themes.classic_blue}
      lang="es"
      itemName="informe.txt"
      driveId="real_C"
      // An expression, because a JSX string attribute would keep the double
      // backslash literal and the listing lookup would miss.
      startPath={'C:\\Temp'}
      drives={drives}
      onConfirm={onConfirm}
      onClose={vi.fn()}
      {...props}
    />,
  );
  return onConfirm;
};

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('ChooseFolderModal drive row', () => {
  it('offers every mounted real drive and no virtual or unplugged one', async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText(t.chooseFolderDrive)).toBeTruthy());

    expect(screen.getByRole('button', { name: '[C:]' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '[D:]' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '[E:]' })).toBeNull();
    expect(screen.queryByRole('button', { name: '[V:]' })).toBeNull();
  });

  it('opens on the folder it was given, without touching another drive', async () => {
    renderPicker();

    await waitFor(() => expect(screen.getByText('Escritorio')).toBeTruthy());
    expect(fsEngine.loadSystemDriveDirectory).toHaveBeenCalledWith('real_C', 'C:\\Temp');
    expect(screen.getByText('C:\\Temp')).toBeTruthy();
  });

  it('switches drive by resetting the browse position to that drive root', async () => {
    const onConfirm = renderPicker();
    await waitFor(() => expect(screen.getByText('Escritorio')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '[D:]' }));

    await waitFor(() => expect(screen.getByText('Proyectos')).toBeTruthy());
    expect(fsEngine.loadSystemDriveDirectory).toHaveBeenCalledWith('real_D', 'D:');
    expect(screen.getByText('D:')).toBeTruthy();
    expect(screen.queryByText('Escritorio')).toBeNull();

    // Down into a folder and back up must land on the new drive's root, never on
    // the previous drive's path the stack was seeded with.
    fireEvent.click(screen.getByText('Proyectos'));
    await waitFor(() => expect(screen.getByText(t.chooseFolderEmpty)).toBeTruthy());
    expect(fsEngine.loadSystemDriveDirectory).toHaveBeenCalledWith('real_D', 'D:\\Proyectos');

    fireEvent.click(screen.getByRole('button', { name: '..' }));
    await waitFor(() => expect(screen.getByText('Proyectos')).toBeTruthy());
    expect(screen.getByText('D:')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.chooseFolderCopyHere) }));
    expect(onConfirm).toHaveBeenCalledWith('D:');
  });

  it('returns the folder on the switched drive, not the one it opened on', async () => {
    const onConfirm = renderPicker();
    await waitFor(() => expect(screen.getByText('Escritorio')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '[D:]' }));
    await waitFor(() => expect(screen.getByText('Proyectos')).toBeTruthy());
    fireEvent.click(screen.getByText('Proyectos'));
    await waitFor(() => expect(screen.getByText(t.chooseFolderEmpty)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.chooseFolderCopyHere) }));
    expect(onConfirm).toHaveBeenCalledWith('D:\\Proyectos');
  });
});

describe('ChooseFolderModal remembered destination', () => {
  it('reopens on the folder the last copy landed in, not on the panel path', async () => {
    renderPicker({ rememberedFolder: 'D:\\Proyectos' });

    await waitFor(() => expect(screen.getByText(t.chooseFolderEmpty)).toBeTruthy());
    expect(fsEngine.loadSystemDriveDirectory).toHaveBeenCalledWith('real_D', 'D:\\Proyectos');
    expect(screen.getByText('D:\\Proyectos')).toBeTruthy();
    expect(screen.getByRole('button', { name: '[D:]' }).className).toContain('bg-amber-400');
    expect(fsEngine.loadSystemDriveDirectory).not.toHaveBeenCalledWith('real_C', 'C:\\Temp');
  });

  it('falls back to the panel folder when the remembered one no longer exists', async () => {
    renderPicker({ rememberedFolder: 'D:\\Borrada' });

    await waitFor(() => expect(screen.getByText('Escritorio')).toBeTruthy());
    expect(fsEngine.loadSystemDriveDirectory).toHaveBeenCalledWith('real_D', 'D:\\Borrada');
    expect(fsEngine.loadSystemDriveDirectory).toHaveBeenCalledWith('real_C', 'C:\\Temp');
    expect(screen.getByText('C:\\Temp')).toBeTruthy();
    expect(screen.getByRole('button', { name: '[C:]' }).className).toContain('bg-amber-400');
  });

  it('ignores a remembered folder on a drive that is not plugged in', async () => {
    renderPicker({ rememberedFolder: 'E:\\Copias' });

    await waitFor(() => expect(screen.getByText('Escritorio')).toBeTruthy());
    expect(fsEngine.loadSystemDriveDirectory).not.toHaveBeenCalledWith('real_E', 'E:\\Copias');
    expect(screen.getByText('C:\\Temp')).toBeTruthy();
  });

  it('returns the remembered folder untouched when the user copies again', async () => {
    const onConfirm = renderPicker({ rememberedFolder: 'D:\\Proyectos' });
    await waitFor(() => expect(screen.getByText(t.chooseFolderEmpty)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.chooseFolderCopyHere) }));
    expect(onConfirm).toHaveBeenCalledWith('D:\\Proyectos');
  });
});
