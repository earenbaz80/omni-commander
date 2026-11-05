import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import { themes } from '../../services/themeManager';
import type { FileItem } from '../../types';

const absolutePathFor = vi.fn();
const onSaved = vi.fn();
const onClose = vi.fn();

vi.mock('../../services/soundEffects', () => ({
  soundManager: {
    playKeyTick: vi.fn(),
    playDiskAccess: vi.fn(),
    playSuccess: vi.fn(),
    playSelectSound: vi.fn(),
    playError: vi.fn(),
  },
}));

vi.mock('../../services/fileSystem', () => ({
  fsEngine: { absolutePathFor: (item: FileItem) => absolutePathFor(item) },
}));

const { ImageStudioModal } = await import('./ImageStudioModal');

const t = translations.es;

const file = {
  id: 'foto',
  name: 'foto',
  ext: 'png',
  path: 'C:\\fotos',
  size: 1024,
  isDirectory: false,
  driveId: 'real_C',
  attributes: { readOnly: false, hidden: false, system: false },
} as unknown as FileItem;

/**
 * jsdom never decodes an image, so the blob URL would leave the dialog loading
 * forever. The fake fires `onload` as soon as `src` is set, which is exactly the
 * moment the real one would.
 */
class FakeImage {
  naturalWidth = 40;
  naturalHeight = 20;
  width = 40;
  height = 20;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    void Promise.resolve().then(() => this.onload?.());
  }
}

const writeResponse = { ok: true, status: 200, json: async () => ({}) };
const fetchMock = vi.fn(async (input: unknown) => {
  const url = String(input);
  if (url.includes('/api/media')) return { ok: true, status: 200, blob: async () => new Blob(['x']) };
  return writeResponse;
});

const renderModal = () =>
  render(<ImageStudioModal theme={themes.classic_blue} lang="es" file={file} onSaved={onSaved} onClose={onClose} />);

const originalToBlob = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'toBlob');

beforeEach(() => {
  absolutePathFor.mockReset();
  absolutePathFor.mockReturnValue('C:\\fotos\\foto.png');
  onSaved.mockReset();
  onClose.mockReset();
  fetchMock.mockClear();
  writeResponse.ok = true;
  writeResponse.status = 200;
  writeResponse.json = async () => ({});

  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:foto'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    value: (callback: BlobCallback) => callback(new Blob(['x'])),
    configurable: true,
  });
});

afterAll(() => {
  if (originalToBlob) Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', originalToBlob);
});

describe('ImageStudioModal loading', () => {
  it('renders nothing at all when there is no file to show', () => {
    const { container } = render(
      <ImageStudioModal theme={themes.classic_blue} lang="es" file={null} onClose={onClose} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('says so when the entry has no path the server could serve', async () => {
    absolutePathFor.mockReturnValue(null);
    renderModal();

    expect(await screen.findByText(t.imageLoadError)).toBeTruthy();
    // Nothing was asked to the server: there was no URL to ask for.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names the HTTP status when the server refuses the picture', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403 })),
    );
    renderModal();

    expect(await screen.findByText(t.imageLoadError)).toBeTruthy();
    const save = screen.getByText(t.imageSaveAs).closest('button') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('shows the picture and its real size once it decodes', async () => {
    renderModal();

    expect(await screen.findByText(/40×20/)).toBeTruthy();
    const save = screen.getByText(t.imageSaveAs).closest('button') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });
});

describe('ImageStudioModal edits', () => {
  it('moves the sliders and puts them back with reset', async () => {
    renderModal();
    await screen.findByText(/40×20/);

    const [brightness] = Array.from(document.querySelectorAll('input[type="range"]')) as HTMLInputElement[];
    fireEvent.change(brightness, { target: { value: '150' } });
    expect(screen.getByText(new RegExp(`${t.imageBrightness}: 150%`))).toBeTruthy();

    fireEvent.click(screen.getByText(t.imageReset));
    expect(screen.getByText(new RegExp(`${t.imageBrightness}: 100%`))).toBeTruthy();
  });

  it('keeps the zoom between the two bounds instead of running away', async () => {
    renderModal();

    // The size label comes from the decoded picture, but the on-screen size is a
    // style the paint effect sets one render later, so the label alone is not a
    // promise that the canvas has been sized yet.
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    await waitFor(() => expect(canvas.style.width).toBe('40px'));

    for (let i = 0; i < 40; i++) fireEvent.click(screen.getByTitle(t.imageZoomIn));
    expect(canvas.style.width).toBe('320px');

    for (let i = 0; i < 40; i++) fireEvent.click(screen.getByTitle(t.imageZoomOut));
    expect(canvas.style.width).toBe('4px');
  });
});

describe('ImageStudioModal save', () => {
  it('writes the edited copy beside the original and says where it went', async () => {
    renderModal();
    await screen.findByText(/40×20/);

    fireEvent.click(screen.getByText(t.imageSaveAs).closest('button')!);

    expect(await screen.findByText(new RegExp(t.imageSaved))).toBeTruthy();
    const writeCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/fs/write-bytes'));
    expect(writeCall, 'the copy is written through the local server').toBeTruthy();
    expect(String(writeCall![0])).toContain(`path=${encodeURIComponent('C:\\fotos\\foto-editada-')}`);
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows the reason the server gave instead of a silent failure', async () => {
    writeResponse.ok = false;
    writeResponse.status = 507;
    writeResponse.json = async () => ({ error: 'sin espacio' });
    renderModal();
    await screen.findByText(/40×20/);

    fireEvent.click(screen.getByText(t.imageSaveAs).closest('button')!);

    await waitFor(() => expect(screen.getByText(new RegExp('sin espacio'))).toBeTruthy());
    expect(onSaved).not.toHaveBeenCalled();
    // The button is usable again: a failed write is not a broken dialog.
    const save = screen.getByText(t.imageSaveAs).closest('button') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });
});
