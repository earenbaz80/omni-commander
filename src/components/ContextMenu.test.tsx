import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu } from './ContextMenu';
import { themes } from '../services/themeManager';
import { FileItem } from '../types';

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

const folder: FileItem = {
  ...file,
  id: 'd1',
  name: 'proyectos',
  ext: '',
  fullName: 'proyectos',
  isDirectory: true,
};

const archive: FileItem = { ...file, id: 'z1', name: 'respaldo', ext: 'ZIP', fullName: 'respaldo.zip' };

const buildProps = (targetItem: FileItem) => ({
  theme: themes.classic_blue,
  lang: 'es' as const,
  x: 10,
  y: 10,
  targetItem,
  onClose: vi.fn(),
  onView: vi.fn(),
  onEdit: vi.fn(),
  onCopy: vi.fn(),
  onMove: vi.fn(),
  onDelete: vi.fn(),
  onRename: vi.fn(),
  onMkDir: vi.fn(),
  onNewFile: vi.fn(),
  onZip: vi.fn(),
  onChecksum: vi.fn(),
  onProperties: vi.fn(),
  onDownload: vi.fn(),
  onUpload: vi.fn(),
  onRefresh: vi.fn(),
  onProtectFolder: vi.fn(),
});

describe('ContextMenu on a selected item', () => {
  /**
   * Right-clicking an entry used to offer only per-item actions, so renaming or
   * creating anything meant right-clicking the empty area first.
   */
  it('offers renaming the item it was opened on', () => {
    const props = buildProps(file);
    render(<ContextMenu {...props} />);

    fireEvent.click(screen.getByText('Renombrar'));

    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalled();
  });

  /**
   * Extraction used to be reachable only through the compression window. The
   * menu now names the destinations a file manager is expected to offer, and
   * offers none of them for something that is not an archive.
   */
  it('offers the extract destinations on an archive, and only on one', () => {
    const onExtractHere = vi.fn();
    const onExtractIntoFolder = vi.fn();
    const onExtractToOtherPanel = vi.fn();
    const { unmount } = render(
      <ContextMenu
        {...buildProps(archive)}
        isArchive
        onExtractHere={onExtractHere}
        onExtractIntoFolder={onExtractIntoFolder}
        onExtractToOtherPanel={onExtractToOtherPanel}
      />,
    );

    fireEvent.click(screen.getByText('Extraer'));
    fireEvent.click(screen.getByText('Extraer en «respaldo»'));
    expect(onExtractIntoFolder).toHaveBeenCalledTimes(1);

    unmount();
    render(<ContextMenu {...buildProps(file)} />);
    expect(screen.queryByText('Extraer')).toBeNull();
  });

  it('offers no "Enviar a" for a drive without files on disk', () => {
    const props = buildProps(file);
    render(<ContextMenu {...props} canSendTo={false} onSendTo={vi.fn()} />);

    expect(screen.queryByText(/Escritorio \(acceso directo\)/)).toBeNull();
    expect(screen.queryByText(/Elegir carpeta/)).toBeNull();
  });

  it('sends to the destination that was picked, and lets a folder be chosen', () => {
    const onSendTo = vi.fn();
    const onSendToFolder = vi.fn();
    render(<ContextMenu {...buildProps(file)} canSendTo={true} onSendTo={onSendTo} onSendToFolder={onSendToFolder} />);

    fireEvent.click(screen.getByText(/Escritorio \(acceso directo\)/));
    fireEvent.click(screen.getByText(/Descargas/));
    fireEvent.click(screen.getByText(/Elegir carpeta/));

    expect(onSendTo.mock.calls).toEqual([['desktop'], ['downloads']]);
    expect(onSendToFolder).toHaveBeenCalledTimes(1);
  });

  /**
   * Pinning is a property of a folder: the tree lists folders, so a file has
   * nothing to pin and must not be offered the command.
   */
  it('pins the folder it was opened on', () => {
    const onToggleFavorite = vi.fn();
    render(<ContextMenu {...buildProps(folder)} onToggleFavorite={onToggleFavorite} />);

    fireEvent.click(screen.getByText('Añadir a favoritos'));

    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
  });

  it('offers the opposite command once the folder is already pinned', () => {
    const onToggleFavorite = vi.fn();
    render(<ContextMenu {...buildProps(folder)} onToggleFavorite={onToggleFavorite} isFavorite={true} />);

    expect(screen.queryByText('Añadir a favoritos')).toBeNull();
    fireEvent.click(screen.getByText('Quitar de favoritos'));

    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
  });

  it('never offers pinning for a file', () => {
    render(<ContextMenu {...buildProps(file)} onToggleFavorite={vi.fn()} />);

    expect(screen.queryByText('Añadir a favoritos')).toBeNull();
    expect(screen.queryByText('Quitar de favoritos')).toBeNull();
  });

  it('offers creating a folder and a file from an item too', () => {
    const props = buildProps(folder);
    render(<ContextMenu {...props} />);

    fireEvent.click(screen.getByText('Nueva Carpeta'));
    fireEvent.click(screen.getByText('Nuevo Archivo'));

    expect(props.onMkDir).toHaveBeenCalledTimes(1);
    expect(props.onNewFile).toHaveBeenCalledTimes(1);
  });

  /**
   * A right-click on the last row used to place the menu at a fixed offset from
   * the click, which left its lower half outside the window where nothing could
   * be clicked. The menu is measured and pushed back inside instead.
   */
  it('keeps the menu inside the window when opened at the bottom edge', () => {
    const menuHeight = 600;
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => menuHeight });

    try {
      render(<ContextMenu {...buildProps(file)} x={100} y={window.innerHeight - 10} />);

      const menu = screen.getByRole('menu');
      expect(menu.style.top).toBe(`${window.innerHeight - menuHeight - 8}px`);
      expect(menu.style.left).toBe('100px');
      expect(menu.className).toContain('overflow-y-auto');
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
    }
  });

  /**
   * "Abrir con" used to hand the file straight to the shell dialog, which Windows
   * will not raise above the app when the process that asked for it is not in the
   * foreground: the dialog was created behind the window and the menu looked dead.
   * The submenu lists the programs itself, and keeps the chooser as a last entry.
   */
  it('expands "Abrir con" into the programs registered for the type', async () => {
    const program = { id: 'C:\\Windows\\notepad.exe', name: 'Bloc de notas' };
    const loadOpenWithPrograms = vi.fn().mockResolvedValue([program]);
    const onOpenWithProgram = vi.fn();
    const onOpenWith = vi.fn();
    render(
      <ContextMenu
        {...buildProps(file)}
        canOpenWith={true}
        onOpenWith={onOpenWith}
        loadOpenWithPrograms={loadOpenWithPrograms}
        onOpenWithProgram={onOpenWithProgram}
      />,
    );

    fireEvent.click(screen.getByText('Abrir con…'));

    expect(await screen.findByText('Bloc de notas')).toBeTruthy();
    expect(loadOpenWithPrograms).toHaveBeenCalledTimes(1);
    // Expanding is not opening: nothing has been launched yet.
    expect(onOpenWith).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Bloc de notas'));
    expect(onOpenWithProgram).toHaveBeenCalledWith(program);
  });

  it('says so when the type has no registered programs, and still offers the chooser', async () => {
    const onOpenWith = vi.fn();
    render(
      <ContextMenu
        {...buildProps(file)}
        canOpenWith={true}
        onOpenWith={onOpenWith}
        loadOpenWithPrograms={() => Promise.resolve([])}
      />,
    );

    fireEvent.click(screen.getByText('Abrir con…'));
    expect(await screen.findByText('No hay programas registrados para este tipo')).toBeTruthy();

    fireEvent.click(screen.getByText('Elegir otra aplicación…'));
    expect(onOpenWith).toHaveBeenCalledTimes(1);
  });

  /**
   * "Abrir con" only listed programs registered with Windows, so the viewers and
   * editors this app ships were unreachable from the menu that exists to choose
   * an application.
   */
  it("lists the app's own image studio first for a picture", async () => {
    const onOpenInApp = vi.fn();
    const picture: FileItem = { ...file, ext: 'PNG', name: 'foto', fullName: 'foto.png' };
    render(
      <ContextMenu
        {...buildProps(picture)}
        canOpenWith={true}
        onOpenWith={vi.fn()}
        loadOpenWithPrograms={() => Promise.resolve([])}
        onOpenInApp={onOpenInApp}
      />,
    );

    fireEvent.click(screen.getByText('Abrir con…'));
    expect(await screen.findByText('Imágenes (ver y editar)')).toBeTruthy();
    // A picture is not audio, but it can still be shown in the console.
    expect(screen.queryByText('Reproductor de audio y vídeo')).toBeNull();
    expect(screen.getByText('Abrir en la terminal')).toBeTruthy();

    fireEvent.click(screen.getByText('Imágenes (ver y editar)'));
    expect(onOpenInApp).toHaveBeenCalledWith('image');
  });

  it('offers the player for a video and the editor for text', async () => {
    const onOpenInApp = vi.fn();
    render(
      <ContextMenu
        {...buildProps({ ...file, ext: 'MP4', name: 'clip', fullName: 'clip.mp4' })}
        canOpenWith={true}
        onOpenWith={vi.fn()}
        loadOpenWithPrograms={() => Promise.resolve([])}
        onOpenInApp={onOpenInApp}
      />,
    );
    fireEvent.click(screen.getByText('Abrir con…'));
    fireEvent.click(await screen.findByText('Reproductor de audio y vídeo'));
    expect(onOpenInApp).toHaveBeenCalledWith('media');
  });

  it('offers the text editor and the console for a text file', async () => {
    const onOpenInApp = vi.fn();
    render(
      <ContextMenu
        {...buildProps(file)}
        canOpenWith={true}
        onOpenWith={vi.fn()}
        loadOpenWithPrograms={() => Promise.resolve([])}
        onOpenInApp={onOpenInApp}
      />,
    );
    fireEvent.click(screen.getByText('Abrir con…'));

    expect(await screen.findByText('Editor de texto')).toBeTruthy();
    fireEvent.click(screen.getByText('Abrir en la terminal'));
    expect(onOpenInApp).toHaveBeenCalledWith('terminal');
  });
});
