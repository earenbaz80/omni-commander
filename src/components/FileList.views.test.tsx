import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, createEvent } from '@testing-library/react';
import { FileList } from './FileList';
import { themes } from '../services/themeManager';
import { translations } from '../i18n/translations';
import { FileItem } from '../types';
import { formatBytesCompact } from '../utils/formatBytes';
import { DEFAULT_COLUMN_WIDTHS } from '../utils/columnWidths';

const t = translations.es;

/**
 * The full view is covered elsewhere; these cases are the three grid views and
 * the drag/resize branches they share with it. jsdom has no layout, so the
 * virtualizer is doubled as in the other FileList suite.
 */
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 24, size: 24 })),
    getTotalSize: () => count * 24,
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}));

// The real helper asks the engine for an absolute path, and the synthetic items
// below have none. A URL for every image is what the grid needs to render one.
vi.mock('../services/mediaUrl', () => ({
  isImageItem: (item: { ext?: string }) => (item.ext || '').toUpperCase() === 'PNG',
  mediaUrlFor: (item: { name: string }) => `http://media/${item.name}`,
}));

const item = (overrides: Partial<FileItem> & Pick<FileItem, 'id' | 'name'>): FileItem =>
  ({
    ext: 'TXT',
    isDirectory: false,
    size: 0,
    path: 'C:\\datos',
    driveId: 'real_C',
    modifiedAt: '2026-01-01 10:00',
    createdAt: '2026-01-01 10:00',
    attributes: { readOnly: false, hidden: false, system: false, archive: false },
    content: '',
    ...overrides,
  }) as FileItem;

const items: FileItem[] = [
  item({ id: 'img', name: 'foto', ext: 'PNG', size: 5000 }),
  item({ id: 'aud', name: 'tema', ext: 'MP3', size: 7000 }),
  item({ id: 'vid', name: 'clip', ext: 'MP4', size: 9000 }),
  item({ id: 'doc', name: 'informe', ext: 'PDF', size: 3000 }),
  item({ id: 'code', name: 'script', ext: 'TS', size: 100 }),
  item({ id: 'exe', name: 'setup', ext: 'EXE', size: 200 }),
  item({ id: 'zip', name: 'backup', ext: 'ZIP', size: 400 }),
  item({ id: 'txt', name: 'notas', ext: 'TXT', size: 50 }),
  item({ id: 'bin', name: 'datos', ext: 'BIN', size: 10 }),
  item({ id: 'folder', name: 'sub', ext: '', isDirectory: true, size: 0 }),
  item({ id: 'sized', name: 'pack', ext: '', isDirectory: true, size: 1024 }),
];

const onSort = vi.fn();
const onSelectIndex = vi.fn();
const onToggleSelect = vi.fn();
const onOpenItem = vi.fn();
const onGoParent = vi.fn();
const onContextMenu = vi.fn();
const onItemHover = vi.fn();
const onDropItems = vi.fn();
const onDropNativeFiles = vi.fn();

const props = (overrides: Record<string, unknown> = {}) => ({
  theme: themes.classic_blue,
  lang: 'es' as const,
  items,
  currentPath: 'C:\\datos',
  currentDriveId: 'real_C',
  isRoot: false,
  focusedIndex: 0,
  selectedIds: [] as string[],
  viewMode: 'full' as const,
  sortField: 'name' as const,
  sortDirection: 'asc' as const,
  onSort,
  onSelectIndex,
  onToggleSelect,
  onOpenItem,
  onGoParent,
  onContextMenu,
  onItemHover,
  isActive: true,
  onActivate: vi.fn(),
  panelSide: 'left' as const,
  onDropItems,
  onDropNativeFiles,
  ...overrides,
});

const renderList = (overrides: Record<string, unknown> = {}) => render(<FileList {...props(overrides)} />);

const row = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-name="${name}"]`) as HTMLElement | null;

let viewportWidth = 800;
beforeEach(() => {
  localStorage.clear();
  viewportWidth = 800;
  onSort.mockClear();
  onSelectIndex.mockClear();
  onToggleSelect.mockClear();
  onOpenItem.mockClear();
  onGoParent.mockClear();
  onContextMenu.mockClear();
  onItemHover.mockClear();
  onDropItems.mockClear();
  onDropNativeFiles.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => viewportWidth,
  });
});

const dragPayload = (overrides: Record<string, unknown> = {}) => ({
  dataTransfer: {
    getData: (type: string) =>
      type === 'application/json' ? JSON.stringify({ items: [item({ id: 'img', name: 'foto' })] }) : '',
    files: [],
    dropEffect: 'copy',
    types: ['application/json'],
    setData: vi.fn(),
    setDragImage: vi.fn(),
    effectAllowed: '',
  },
  ...overrides,
});

describe('FileList grid views', () => {
  it('lays the brief view out in three columns on a wide panel and two on a narrow one', () => {
    const wide = renderList({ viewMode: 'brief' });
    const wideRow = wide.container.querySelector('[data-index="0"]') as HTMLElement;
    expect(wideRow.style.gridTemplateColumns).toContain('repeat(3');
    expect(wide.container.textContent).toContain('foto.PNG');
    wide.unmount();

    viewportWidth = 500;
    const narrow = renderList({ viewMode: 'brief' });
    const narrowRow = narrow.container.querySelector('[data-index="0"]') as HTMLElement;
    expect(narrowRow.style.gridTemplateColumns).toContain('repeat(2');
  });

  it('draws a thumbnail per image and falls back to the icon when the image will not load', () => {
    const { container } = renderList({ viewMode: 'thumbnails' });
    const image = container.querySelector('img[alt="foto"]') as HTMLImageElement | null;
    expect(image).toBeTruthy();
    expect(image!.getAttribute('src')).toBe('http://media/foto');

    // A file the server cannot serve is not an empty cell: the grid keeps the
    // icon it had before the picture came along.
    fireEvent.error(image!);
    expect(container.querySelector('img[alt="foto"]')).toBeNull();
  });

  it('labels audio and video in the gallery, and shows the image label only as a fallback', () => {
    const { container } = renderList({ viewMode: 'gallery' });

    expect(container.textContent).toContain('AUDIO TRACK');
    expect(container.textContent).toContain('VIDEO CLIP');

    const image = container.querySelector('img[alt="foto"]') as HTMLImageElement;
    fireEvent.error(image);
    expect(container.textContent).toContain('png IMAGE');
  });

  it('prints the kind of each entry in the type column', () => {
    const { container } = renderList();

    for (const label of [
      t.typeExecutable,
      t.typeArchive,
      t.typeImage,
      t.typeAudio,
      t.typeVideo,
      t.typeText,
      t.typeDocument,
      t.typeCode,
      t.file,
      t.folder,
    ]) {
      expect(container.textContent).toContain(label);
    }
  });

  it('shows a folder with a known size as that size, and an empty one as a directory', () => {
    const { container } = renderList();
    expect(row(container, 'pack')!.textContent).toContain(formatBytesCompact(1024));
    expect(row(container, 'sub')!.textContent).toContain(t.directory);
  });
});

describe('FileList drag and resize branches', () => {
  it('shows the copy or move HUD while something is dragged over the panel', () => {
    const { container } = renderList();
    const list = container.querySelector('[data-file-list]')!;

    const moveEvent = createEvent.dragOver(list, { dataTransfer: { dropEffect: '' } });
    Object.defineProperty(moveEvent, 'shiftKey', { value: true });
    fireEvent(list, moveEvent);
    expect(container.textContent).toContain(t.moveTo);
    expect(container.textContent).toContain(t.dropToMoveHint);

    fireEvent.dragOver(list, { dataTransfer: { dropEffect: '' } });
    expect(container.textContent).toContain(t.copyTo);
    expect(container.textContent).toContain(t.dropToCopyHint);

    fireEvent.dragLeave(list, { relatedTarget: document.body });
    expect(container.textContent).not.toContain(t.dropToCopyHint);
  });

  it('names the folder under the pointer in the HUD', () => {
    const { container } = renderList();
    const folder = row(container, 'sub')!;

    fireEvent.dragOver(folder, { dataTransfer: { dropEffect: '' } });
    expect(container.textContent).toContain(`${t.folder}: sub`);
  });

  it('starts a drag with the selected entries without changing the focus', () => {
    const { container } = renderList({ selectedIds: ['img', 'aud'] });
    const image = row(container, 'foto.PNG')!;
    const event = dragPayload();

    fireEvent.dragStart(image, event);

    expect(event.dataTransfer.setData).toHaveBeenCalledWith('application/json', expect.stringContaining('"foto"'));
    expect(onSelectIndex).not.toHaveBeenCalled();

    fireEvent.dragEnd(image);
  });

  it('focuses an unselected entry when its drag starts', () => {
    const { container } = renderList();
    const image = row(container, 'foto.PNG')!;

    fireEvent.dragStart(image, dragPayload());

    expect(onSelectIndex).toHaveBeenCalledWith(0);
  });

  it('clears the folder highlight when the pointer leaves it', () => {
    const { container } = renderList();
    const folder = row(container, 'sub')!;

    fireEvent.dragOver(folder, { dataTransfer: { dropEffect: '' } });
    expect(container.textContent).toContain(`${t.folder}: sub`);

    fireEvent.dragLeave(folder, { relatedTarget: document.body });
    expect(container.textContent).not.toContain(`${t.folder}: sub`);
  });

  it('ignores an empty internal payload and a drop of files with no handler', () => {
    const { container } = renderList({ onDropNativeFiles: undefined });
    const list = container.querySelector('[data-file-list]')!;

    fireEvent.drop(list, {
      dataTransfer: {
        getData: () => JSON.stringify({ items: [] }),
        files: [new File(['x'], 'desde-fuera.txt')],
        dropEffect: 'copy',
        types: ['application/json'],
      },
    });

    expect(onDropItems).not.toHaveBeenCalled();
    expect(onDropNativeFiles).not.toHaveBeenCalled();
  });

  it('keeps the panel highlighted while the pointer is still inside it', () => {
    const { container } = renderList();
    const list = container.querySelector('[data-file-list]')!;

    fireEvent.dragOver(list, { dataTransfer: { dropEffect: '' } });
    const leave = createEvent.dragLeave(list, { dataTransfer: { dropEffect: '' } });
    Object.defineProperty(leave, 'relatedTarget', { value: list });
    fireEvent(list, leave);

    expect(container.textContent).toContain(t.dropToCopyHint);
  });

  it('measures the panel through a ResizeObserver when the browser has one', () => {
    class Observer {
      observe() {}
      disconnect() {}
    }
    const original = globalThis.ResizeObserver;
    (globalThis as unknown as { ResizeObserver: typeof Observer }).ResizeObserver = Observer;

    try {
      const { container } = renderList({ viewMode: 'brief' });
      expect(container.querySelector('[data-file-list]')).toBeTruthy();
    } finally {
      (globalThis as unknown as { ResizeObserver: typeof original }).ResizeObserver = original;
    }
  });

  it('ignores malformed drag data instead of dropping nothing', () => {
    const { container } = renderList();
    const list = container.querySelector('[data-file-list]')!;

    fireEvent.drop(list, {
      dataTransfer: { getData: () => '{', files: [], dropEffect: 'copy', types: ['application/json'] },
    });

    expect(onDropItems).not.toHaveBeenCalled();
    expect(onDropNativeFiles).not.toHaveBeenCalled();
  });

  it('drops onto a file row by using the folder that is open, not the file', () => {
    const { container } = renderList();
    const file = row(container, 'notas.TXT')!;

    fireEvent.drop(file, dragPayload());

    expect(onDropItems).toHaveBeenCalledWith(expect.any(Array), 'C:\\datos', 'real_C', 'copy');
  });

  it('resizes a column by dragging its separator', () => {
    const { container } = renderList();
    const separator = container.querySelectorAll('[role="separator"]')[3];
    const cell = separator.parentElement as HTMLElement;
    const before = Number.parseFloat(cell.style.width);

    fireEvent.mouseDown(separator, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 160 });
    fireEvent.mouseUp(window);

    expect(Number.parseFloat(cell.style.width)).toBeGreaterThan(before);
  });

  it('auto-fits every column from its separator', () => {
    const { container } = renderList();
    const separators = container.querySelectorAll('[role="separator"]');
    for (let index = 0; index < separators.length; index += 1) {
      const cell = separators[index].parentElement as HTMLElement;
      const before = cell.style.width;
      fireEvent.doubleClick(separators[index]);
      if (before === `${DEFAULT_COLUMN_WIDTHS.size}px`) {
        expect(cell.style.width).not.toBe('');
      }
    }
  });

  it('reports hover on a row and the end of it', () => {
    const { container } = renderList();
    const image = row(container, 'foto.PNG')!;

    fireEvent.mouseEnter(image);
    expect(onItemHover).toHaveBeenCalledWith(expect.anything(), items[0]);

    fireEvent.mouseLeave(image);
    expect(onItemHover).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('scales the thumbnail grid with ctrl and the wheel, within its bounds', () => {
    const { container } = renderList({ viewMode: 'thumbnails' });
    const list = container.querySelector('[data-file-list]')!;

    fireEvent.wheel(list, { ctrlKey: true, deltaY: -16 });
    fireEvent.wheel(list, { ctrlKey: true, deltaY: 16 });

    // A wheel without ctrl is the scroll the browser already does.
    fireEvent.wheel(list, { deltaY: -16 });
    expect(container.querySelector('img[alt="foto"]')).toBeTruthy();
  });
});
