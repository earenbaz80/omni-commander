import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, createEvent } from '@testing-library/react';
import { FileList } from './FileList';
import { themes } from '../services/themeManager';
import { translations } from '../i18n/translations';
import { FileItem } from '../types';
import { formatBytes } from '../utils/formatBytes';

const t = translations.es;

/**
 * jsdom has no layout: the virtualizer measures a scroll area of zero and draws
 * no rows at all. This double keeps its contract — every index with a start, a
 * size and a key — and nothing else, so what the test sees is the row logic.
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
  item({
    id: 'f1',
    name: 'notas',
    size: 123456,
    attributes: { readOnly: true, hidden: false, system: true, archive: true },
  }),
  item({ id: 'f2', name: 'programa', ext: 'EXE', size: 2048 }),
  item({ id: 'd1', name: 'sub', ext: '', isDirectory: true, size: 0 }),
];

const onSort = vi.fn();
const onSelectIndex = vi.fn();
const onToggleSelect = vi.fn();
const onOpenItem = vi.fn();
const onGoParent = vi.fn();
const onContextMenu = vi.fn();
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

describe('FileList rows', () => {
  it('draws each entry with its size, type and attributes', () => {
    const { container } = renderList();
    const notes = row(container, 'notas.TXT');

    expect(notes).toBeTruthy();
    expect(notes!.textContent).toContain('notas');
    expect(notes!.textContent).toContain('TXT');
    expect(notes!.textContent).toContain(t.typeText);
    // 123456 bytes is 120.6 kB, and the attribute column is R.SA.
    expect(notes!.textContent).toContain('120.6 k');
    expect(notes!.textContent).toContain('R.SA');
    // A folder shows its kind instead of a size it does not have.
    expect(row(container, 'sub')!.textContent).toContain(t.folder);
  });

  it('counts files, folders and the selected weight in the status bar', () => {
    const { container } = renderList({ selectedIds: ['f1', 'd1'] });

    expect(container.textContent).toContain(`2 ${t.filesCount}`);
    expect(container.textContent).toContain(`1 ${t.dirsCount}`);
    // A folder adds to the count but not to the bytes, and the weight picks its
    // unit instead of counting kilobytes whatever the size.
    expect(container.textContent).toContain(`2 ${t.selectedCount} (${formatBytes(123456)})`);
  });

  it('marks the focused row and the caret, but only while the panel is active', () => {
    const { container, rerender } = renderList();

    expect(row(container, 'notas.TXT')!.getAttribute('data-focused')).toBe('true');
    expect(row(container, 'notas.TXT')!.textContent).toContain('█');

    rerender(<FileList {...props({ isActive: false })} />);
    expect(row(container, 'notas.TXT')!.getAttribute('data-focused')).toBe('false');
    expect(row(container, 'notas.TXT')!.textContent).not.toContain('█');
  });

  it('selects with a click, toggles with a modified click and opens with a double click', () => {
    const { container } = renderList();
    const notes = row(container, 'notas.TXT')!;

    fireEvent.click(notes);
    expect(onSelectIndex).toHaveBeenCalledWith(0);

    fireEvent.click(notes, { ctrlKey: true });
    expect(onToggleSelect).toHaveBeenCalledWith('f1');

    fireEvent.doubleClick(notes);
    expect(onOpenItem).toHaveBeenCalledWith(items[0]);

    fireEvent.contextMenu(notes);
    expect(onContextMenu).toHaveBeenCalledWith(expect.anything(), items[0]);
  });

  it('offers the check box as a pressed toggle for the selected entries', () => {
    const { container } = renderList({ selectedIds: ['f1'] });
    const check = row(container, 'notas.TXT')!.querySelector('button')!;

    expect(check.getAttribute('aria-pressed')).toBe('true');
    expect(check.textContent).toContain('✓');

    fireEvent.click(check);
    expect(onToggleSelect).toHaveBeenCalledWith('f1');
    // The row click did not also fire: the check box belongs to itself.
    expect(onSelectIndex).not.toHaveBeenCalled();
  });

  it('walks to the parent entry unless the panel is already at the root', () => {
    const { container, rerender } = renderList();
    const parent = container.querySelector('[data-file-list] div')!;

    // `..` alone is not a marker: a file with no attributes prints `....` in its
    // own column. The parent row is the one that carries the tag.
    expect(parent.textContent).toContain('<UP--DIR>');
    fireEvent.click(parent);
    expect(onGoParent).toHaveBeenCalled();

    rerender(<FileList {...props({ isRoot: true })} />);
    expect(container.textContent).not.toContain('<UP--DIR>');
  });

  it('sorts from the column headers', () => {
    const { getByText } = renderList();

    fireEvent.click(getByText(t.size));
    expect(onSort).toHaveBeenCalledWith('size');

    fireEvent.click(getByText(t.date));
    expect(onSort).toHaveBeenCalledWith('modifiedAt');
  });

  it('says the folder is empty when there is nothing to list', () => {
    const { container } = renderList({ items: [] });

    expect(container.textContent).toContain(`<${t.emptyFolder}>`);
    expect(container.textContent).toContain(t.emptyFolderDropHint);
  });
});

describe('FileList drop', () => {
  const dragEvent = (payload: unknown) => ({
    dataTransfer: {
      getData: (type: string) => (type === 'application/json' && payload ? JSON.stringify(payload) : ''),
      files: [],
      dropEffect: 'copy',
      types: payload ? ['application/json'] : [],
    },
  });

  it('copies the dragged entries into the folder under the pointer', () => {
    const { container } = renderList();
    const folder = row(container, 'sub')!;
    const dragged = [item({ id: 'f1', name: 'notas' })];

    fireEvent.drop(folder, dragEvent({ items: dragged }));

    expect(onDropItems).toHaveBeenCalledWith(dragged, 'C:\\datos\\sub', 'real_C', 'copy');
  });

  it('moves instead of copying when shift is held', () => {
    const { container } = renderList();
    const dragged = [item({ id: 'f1', name: 'notas' })];
    const element = container.querySelector('[data-file-list]')!;

    // A plain Event drops a `shiftKey` passed in the initialiser, so the key has
    // to ride on a mouse event, which is what a real drag emits.
    const event = createEvent.drop(element, dragEvent({ items: dragged }));
    Object.defineProperty(event, 'shiftKey', { value: true });
    fireEvent(element, event);

    expect(onDropItems).toHaveBeenCalledWith(dragged, 'C:\\datos', 'real_C', 'move');
  });

  it('refuses to drop a folder inside itself', () => {
    const { container } = renderList();
    const folder = row(container, 'sub')!;
    const dragged = [item({ id: 'd1', name: 'sub', ext: '', isDirectory: true })];

    fireEvent.drop(folder, dragEvent({ items: dragged }));

    expect(onDropItems).not.toHaveBeenCalled();
  });

  it('passes files dragged in from the desktop on to the caller', () => {
    const { container } = renderList();
    const files = [new File(['x'], 'desde-fuera.txt')];

    fireEvent.drop(container.querySelector('[data-file-list]')!, {
      dataTransfer: { getData: () => '', files, dropEffect: 'copy', types: ['Files'] },
    });

    expect(onDropNativeFiles).toHaveBeenCalledWith(files, 'C:\\datos', 'real_C');
    expect(onDropItems).not.toHaveBeenCalled();
  });
});
