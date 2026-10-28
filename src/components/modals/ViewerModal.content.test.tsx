import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ViewerModal } from './ViewerModal';
import { themes } from '../../services/themeManager';
import { translations } from '../../i18n/translations';
import { fsEngine } from '../../services/fileSystem';
import { MAX_TEXT_FILE_BYTES } from '../../utils/fileContent';
import { FileItem } from '../../types';

const t = translations.es;

const realFile: FileItem = {
  id: 'f1',
  name: 'notas',
  ext: 'TXT',
  fullName: 'notas.txt',
  path: 'C:\\Temp',
  driveId: 'real_C',
  isDirectory: false,
  size: 12,
  modifiedAt: '2026-10-20 10:00',
  createdAt: '2026-10-20 10:00',
  attributes: { readOnly: false, hidden: false, system: false, archive: true },
};

const bytesOf = (text: string) => new TextEncoder().encode(text);

const renderViewer = () =>
  render(<ViewerModal theme={themes.classic_blue} lang="es" file={realFile} onClose={vi.fn()} onEdit={vi.fn()} />);

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('ViewerModal content loading', () => {
  it('shows the real file text and counts its characters', async () => {
    vi.spyOn(fsEngine, 'readFileBytes').mockResolvedValue(bytesOf('contenido-real'));

    renderViewer();

    await waitFor(() => expect(screen.getByText('contenido-real')).toBeTruthy());
    expect(screen.getByText(t.viewerLinesChars.replace('{n}', '1').replace('{total}', '14'))).toBeTruthy();
  });

  it('says it is loading rather than showing an empty file', async () => {
    vi.spyOn(fsEngine, 'readFileBytes').mockReturnValue(new Promise(() => {}));

    renderViewer();

    expect(screen.getAllByText(t.contentLoading).length).toBeGreaterThan(0);
  });

  it('tells the user why the file could not be read, and offers a retry', async () => {
    vi.spyOn(fsEngine, 'readFileBytes').mockRejectedValue(new Error('acceso denegado'));

    renderViewer();

    await waitFor(() => expect(screen.getByText(t.contentLoadFailed)).toBeTruthy());
    expect(screen.getByText('acceso denegado')).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(t.contentLoadRetry) })).toBeTruthy();
  });

  it('refuses hex editing of a file on disk, which a text write would corrupt', async () => {
    vi.spyOn(fsEngine, 'readFileBytes').mockResolvedValue(bytesOf('contenido-real'));

    renderViewer();
    await waitFor(() => expect(screen.getByText('contenido-real')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.viewerHexadecimal) }));

    const toggle = screen.getByRole('button', { name: new RegExp(t.viewerHexEditEnable) }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.title).toBe(t.viewerHexEditRealBlocked);
  });

  it('offers hex editing for an in-app file, which is written as text anyway', async () => {
    const virtualFile: FileItem = { ...realFile, id: 'v1', driveId: 'vfs', content: 'hola' };
    vi.spyOn(fsEngine, 'readFileBytes').mockResolvedValue(bytesOf('hola'));

    render(<ViewerModal theme={themes.classic_blue} lang="es" file={virtualFile} onClose={vi.fn()} onEdit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('hola')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.viewerHexadecimal) }));

    const toggle = screen.getByRole('button', { name: new RegExp(t.viewerHexEditEnable) }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
  });

  it('offers no hex editing or saving while the file is still loading', async () => {
    const saveSpy = vi.spyOn(fsEngine, 'saveFileContent').mockImplementation(() => undefined);
    vi.spyOn(fsEngine, 'readFileBytes').mockReturnValue(new Promise(() => {}));

    renderViewer();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.viewerHexadecimal) }));

    expect(screen.queryByRole('button', { name: new RegExp(t.viewerHexEditEnable) })).toBeNull();
    expect(screen.queryByText(t.viewerSaveVfs)).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('blocks hex editing of binary content, whose bytes a text write cannot reproduce', async () => {
    const virtualFile: FileItem = { ...realFile, id: 'v1', driveId: 'vfs' };
    const saveSpy = vi.spyOn(fsEngine, 'saveFileContent').mockImplementation(() => undefined);
    vi.spyOn(fsEngine, 'readFileBytes').mockResolvedValue(new Uint8Array([0x4d, 0x5a, 0x00, 0x10]));

    render(<ViewerModal theme={themes.classic_blue} lang="es" file={virtualFile} onClose={vi.fn()} onEdit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(t.viewerBinaryContent)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.viewerHexadecimal) }));

    const toggle = screen.getByRole('button', { name: new RegExp(t.viewerHexEditEnable) }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.title).toBe(t.viewerBinaryContent);
    expect(screen.queryByText(t.viewerSaveVfs)).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('blocks hex editing of a file past the read cap, whose unread tail a save would drop', async () => {
    const virtualFile: FileItem = { ...realFile, id: 'v1', driveId: 'vfs' };
    const saveSpy = vi.spyOn(fsEngine, 'saveFileContent').mockImplementation(() => undefined);
    vi.spyOn(fsEngine, 'readFileBytes').mockResolvedValue(new Uint8Array(MAX_TEXT_FILE_BYTES + 1).fill(0x61));
    const truncatedNotice = t.contentTruncated.replace('{size}', '2.0 MB');

    render(<ViewerModal theme={themes.classic_blue} lang="es" file={virtualFile} onClose={vi.fn()} onEdit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(truncatedNotice)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.viewerHexadecimal) }));

    const toggle = screen.getByRole('button', { name: new RegExp(t.viewerHexEditEnable) }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.title).toBe(t.editorTruncatedBlocked);
    expect(screen.queryByText(t.viewerSaveVfs)).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('writes an edited byte back as the loaded content, and only that', async () => {
    const virtualFile: FileItem = { ...realFile, id: 'v2', driveId: 'vfs', content: 'AB' };
    const saveSpy = vi.spyOn(fsEngine, 'saveFileContent').mockImplementation(() => undefined);
    vi.spyOn(fsEngine, 'readFileBytes').mockResolvedValue(bytesOf('AB'));

    render(<ViewerModal theme={themes.classic_blue} lang="es" file={virtualFile} onClose={vi.fn()} onEdit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('AB')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.viewerHexadecimal) }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.viewerHexEditEnable) }));

    // 'A' (0x41) becomes 'Z' (0x5A); the neighbouring byte must survive untouched.
    fireEvent.change(screen.getAllByDisplayValue('41')[0], { target: { value: '5A' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.viewerSaveVfs) }));

    expect(saveSpy).toHaveBeenCalledWith('v2', 'ZB');
  });
});
