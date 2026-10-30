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
});
