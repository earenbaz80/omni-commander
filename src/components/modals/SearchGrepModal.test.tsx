import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import { themes } from '../../services/themeManager';
import type { FileItem } from '../../types';

const contents = new Map<string, Uint8Array>();
const getSearchIndex = vi.fn();
const readFileBytes = vi.fn();

vi.mock('../../services/soundEffects', () => ({
  soundManager: {
    playKeyTick: vi.fn(),
    playDiskAccess: vi.fn(),
    playSuccess: vi.fn(),
    playSelectSound: vi.fn(),
    playError: vi.fn(),
    playBeep: vi.fn(),
  },
}));

vi.mock('../../services/fileSystem', () => ({
  fsEngine: {
    getSearchIndex: (...args: unknown[]) => getSearchIndex(...args),
    readFileBytes: (...args: unknown[]) => readFileBytes(...args),
  },
}));

const { SearchGrepModal } = await import('./SearchGrepModal');

const t = translations.es;
const onClose = vi.fn();
const onSelectFile = vi.fn();

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

const file = (
  name: string,
  overrides: Partial<{ size: number; modifiedAt: string; readOnly: boolean; hidden: boolean; ext: string }> = {},
): FileItem =>
  ({
    id: name,
    name,
    ext: overrides.ext ?? 'txt',
    path: 'C:\\docs',
    size: overrides.size ?? 2048,
    modifiedAt: overrides.modifiedAt ?? daysAgo(0),
    isDirectory: false,
    driveId: 'real_C',
    attributes: {
      readOnly: overrides.readOnly ?? false,
      hidden: overrides.hidden ?? false,
      system: false,
    },
  }) as unknown as FileItem;

let files: FileItem[] = [];

const renderModal = () =>
  render(
    <SearchGrepModal
      theme={themes.classic_blue}
      lang="es"
      currentDriveId="real_C"
      currentPath={'C:\\docs'}
      onSelectFile={onSelectFile}
      onClose={onClose}
    />,
  );

const textInputs = () => Array.from(document.querySelectorAll('input[type="text"]')) as HTMLInputElement[];
const patternInput = () => textInputs()[0];
const grepInput = () => textInputs()[1];

const runSearch = async () => fireEvent.submit(document.querySelector('form')!);

const foundCount = (n: number) => t.searchFound.replace('{n}', String(n));

beforeEach(() => {
  localStorage.clear();
  files = [];
  contents.clear();
  getSearchIndex.mockReset();
  getSearchIndex.mockImplementation(() => files);
  readFileBytes.mockReset();
  readFileBytes.mockImplementation(async (item: FileItem) => contents.get(item.name) ?? new Uint8Array());
  onClose.mockReset();
  onSelectFile.mockReset();
});

describe('SearchGrepModal filters', () => {
  it('lists every name that matches while there is no text to look for', async () => {
    files = [file('notas'), file('datos')];
    renderModal();

    await runSearch();

    expect(await screen.findByText(foundCount(2))).toBeTruthy();
    expect(screen.getByText('C:\\docs\\notas.txt')).toBeTruthy();
    // Nothing to grep means nothing is read: the whole point of the cap.
    expect(readFileBytes).not.toHaveBeenCalled();
  });

  it('keeps only the wildcard matches', async () => {
    files = [file('notas'), file('imagen', { ext: 'png' })];
    renderModal();

    fireEvent.change(patternInput(), { target: { value: '*.png' } });
    await runSearch();

    expect(await screen.findByText(foundCount(1))).toBeTruthy();
    expect(screen.getByText(/imagen\.png/)).toBeTruthy();
    expect(screen.queryByText('C:\\docs\\notas.txt')).toBeNull();
  });

  it('finds the text inside a file and shows the line it is on', async () => {
    files = [file('notas')];
    contents.set('notas', new TextEncoder().encode('primera\nsegunda Hola\ntercera'));
    renderModal();

    fireEvent.change(grepInput(), { target: { value: 'hola' } });
    await runSearch();

    expect(await screen.findByText(foundCount(1))).toBeTruthy();
    expect(screen.getByText(t.searchLine.replace('{n}', '2'))).toBeTruthy();
    expect(screen.getByText(/segunda Hola/)).toBeTruthy();
  });

  it('stops matching a different case when the box is ticked', async () => {
    files = [file('notas')];
    contents.set('notas', new TextEncoder().encode('segunda Hola\n'));
    renderModal();

    fireEvent.change(grepInput(), { target: { value: 'hola' } });
    await runSearch();
    expect(await screen.findByText(foundCount(1))).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: t.searchCaseSensitive }));
    await runSearch();

    await waitFor(() => expect(screen.getByText(foundCount(0))).toBeTruthy());
  });

  it('says how many files it could not read instead of counting them as empty', async () => {
    files = [file('notas'), file('binario', { ext: 'bin' })];
    contents.set('notas', new TextEncoder().encode('nada que ver'));
    contents.set('binario', new Uint8Array([65, 0, 66]));
    renderModal();

    fireEvent.change(grepInput(), { target: { value: 'hola' } });
    await runSearch();

    expect(await screen.findByText(t.searchSkipped.replace('{n}', '1'))).toBeTruthy();
    expect(screen.getByText(foundCount(0))).toBeTruthy();
  });

  it('filters by size, attribute and age', async () => {
    files = [
      file('pequeno', { size: 1024 }),
      file('grande', { size: 4096 }),
      file('solo-lectura', { size: 1024, readOnly: true }),
      file('viejo', { size: 1024, modifiedAt: daysAgo(60) }),
    ];
    renderModal();
    await runSearch();
    expect(await screen.findByText(foundCount(4))).toBeTruthy();

    fireEvent.change(document.querySelector('input[type="number"]')!, { target: { value: '3' } });
    await runSearch();
    await waitFor(() => expect(screen.getByText(foundCount(1))).toBeTruthy());
    expect(screen.getByText(/grande\.txt/)).toBeTruthy();

    fireEvent.change(document.querySelector('input[type="number"]')!, { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'R/O' }));
    await runSearch();
    await waitFor(() => expect(screen.getByText(foundCount(1))).toBeTruthy());
    expect(screen.getByText(/solo-lectura\.txt/)).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'R/O' }));
    fireEvent.change(document.querySelector('select')!, { target: { value: 'last_7' } });
    await runSearch();
    await waitFor(() => expect(screen.getByText(foundCount(3))).toBeTruthy());
    expect(screen.queryByText(/viejo\.txt/)).toBeNull();
  });
});

describe('SearchGrepModal history', () => {
  it('remembers a search without repeating it and brings it back on click', async () => {
    files = [file('notas')];
    contents.set('notas', new TextEncoder().encode('segunda Hola\n'));
    renderModal();

    fireEvent.change(grepInput(), { target: { value: 'hola' } });
    await runSearch();
    expect(await screen.findByText(t.searchHistoryCount.replace('{n}', '1'))).toBeTruthy();

    // The same search again is the same entry, not a second one.
    await runSearch();
    expect(await screen.findByText(t.searchHistoryCount.replace('{n}', '1'))).toBeTruthy();

    fireEvent.change(grepInput(), { target: { value: '' } });
    const recall = Array.from(document.querySelectorAll<HTMLButtonElement>('button[title]')).find((button) =>
      (button.getAttribute('title') || '').includes('"hola"'),
    );
    expect(recall, 'the history bar offers the search back').toBeTruthy();
    fireEvent.click(recall!);

    expect(grepInput().value).toBe('hola');

    fireEvent.click(screen.getByTitle(t.searchClearHistory));
    await waitFor(() => expect(screen.queryByText(t.searchHistoryCount.replace('{n}', '1'))).toBeNull());
  });
});
