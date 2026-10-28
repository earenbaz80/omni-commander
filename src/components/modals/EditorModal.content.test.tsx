import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { EditorModal } from './EditorModal';
import { themes } from '../../services/themeManager';
import { translations } from '../../i18n/translations';
import { fsEngine } from '../../services/fileSystem';
import { MAX_TEXT_FILE_BYTES } from '../../utils/fileContent';
import { FileItem } from '../../types';

/**
 * The editor opened `file.content`, which the listing of a real drive never
 * fills, so a real file opened blank and saving wrote that blank buffer over it.
 * These cases pin both halves of the fix: the text on screen comes from disk, and
 * saving is refused until it is really there.
 */
const t = translations.es;

const realFile: FileItem = {
  id: 'f1',
  name: 'datos',
  ext: 'CSV',
  fullName: 'datos.csv',
  path: 'C:\\Temp',
  driveId: 'real_C',
  isDirectory: false,
  size: 28,
  modifiedAt: '2026-10-20 10:00',
  createdAt: '2026-10-20 10:00',
  attributes: { readOnly: false, hidden: false, system: false, archive: true },
};

const bytesOf = (text: string) => new TextEncoder().encode(text);

const renderEditor = (onSave = vi.fn()) => {
  render(<EditorModal theme={themes.classic_blue} lang="es" file={realFile} onSave={onSave} onClose={vi.fn()} />);
  return onSave;
};

const saveButton = () => screen.getByRole('button', { name: new RegExp(t.btnSave) }) as HTMLButtonElement;
const textarea = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const pressCtrlS = () => fireEvent.keyDown(textarea(), { key: 's', ctrlKey: true });

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('EditorModal content loading', () => {
  it("shows the file's real text instead of an empty buffer", async () => {
    vi.spyOn(fsEngine, 'readFileBytes').mockResolvedValue(bytesOf('a,b\n1,2\n'));

    renderEditor();

    await waitFor(() => expect(textarea().value).toBe('a,b\n1,2\n'));
    expect(saveButton().disabled).toBe(false);
  });

  it('refuses to save while the content is still loading', async () => {
    // Never settles: the modal stays in the loading state.
    vi.spyOn(fsEngine, 'readFileBytes').mockReturnValue(new Promise(() => {}));

    const onSave = renderEditor();

    await waitFor(() => expect(screen.getByTestId('editor-save-blocked')).toBeTruthy());
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(saveButton());
    pressCtrlS();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('writes the loaded text on save, including through Ctrl+S', async () => {
    vi.spyOn(fsEngine, 'readFileBytes').mockResolvedValue(bytesOf('original'));

    const onSave = renderEditor();

    await waitFor(() => expect(saveButton().disabled).toBe(false));
    pressCtrlS();

    expect(onSave).toHaveBeenCalledWith('f1', 'original');
  });

  it('keeps saving blocked when the file could not be read', async () => {
    vi.spyOn(fsEngine, 'readFileBytes').mockRejectedValue(new Error('EBUSY'));

    const onSave = renderEditor();

    await waitFor(() => expect(screen.getByText(t.contentLoadFailed)).toBeTruthy());
    expect(saveButton().disabled).toBe(true);
    pressCtrlS();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses a binary file, whose bytes cannot survive a text buffer', async () => {
    vi.spyOn(fsEngine, 'readFileBytes').mockResolvedValue(new Uint8Array([0x4d, 0x5a, 0x00, 0x03]));

    const onSave = renderEditor();

    await waitFor(() => expect(screen.getByText(t.editorBinaryBlocked)).toBeTruthy());
    expect(saveButton().disabled).toBe(true);
    pressCtrlS();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses a file past the read cap, which the write would truncate', async () => {
    // Filled with text bytes on purpose: all zeroes would read as binary and
    // exercise the other guard.
    vi.spyOn(fsEngine, 'readFileBytes').mockResolvedValue(new Uint8Array(MAX_TEXT_FILE_BYTES + 1).fill(0x41));

    renderEditor();

    await waitFor(() => expect(screen.getByText(t.editorTruncatedBlocked)).toBeTruthy());
    expect(saveButton().disabled).toBe(true);
  });
});
