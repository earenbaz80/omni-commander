import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { FileList } from './FileList';
import { themes } from '../services/themeManager';
import { FileItem } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../utils/columnWidths';

const items: FileItem[] = [
  {
    id: '1',
    name: 'documento-largo-de-prueba',
    ext: 'TXT',
    isDirectory: false,
    size: 123456,
    path: 'C:',
    driveId: 'real_C',
    modifiedAt: '2026-01-01 10:00',
    createdAt: '2026-01-01 10:00',
    attributes: { readOnly: false, hidden: false, system: false, archive: true },
    content: '',
  },
];

const baseProps = {
  theme: themes.classic_blue,
  lang: 'es' as const,
  items,
  currentPath: 'C:',
  currentDriveId: 'real_C',
  isRoot: false,
  focusedIndex: 0,
  selectedIds: [] as string[],
  viewMode: 'full' as const,
  sortField: 'name' as const,
  sortDirection: 'asc' as const,
  onSort: vi.fn(),
  onSelectIndex: vi.fn(),
  onToggleSelect: vi.fn(),
  onOpenItem: vi.fn(),
  onGoParent: vi.fn(),
  onContextMenu: vi.fn(),
  isActive: true,
  onActivate: vi.fn(),
  panelSide: 'left' as const,
  onDropItems: vi.fn(),
};

describe('FileList column resizers', () => {
  beforeEach(() => localStorage.clear());

  it('renders a visible resizer between every column label', () => {
    const { container } = render(<FileList {...baseProps} />);
    const separators = container.querySelectorAll('[role="separator"]');
    // name, ext, type, size, date, attr
    expect(separators.length).toBe(6);
    separators.forEach((sep) => {
      expect(sep.getAttribute('aria-label')).toMatch(/^Redimensionar columna /);
    });
  });

  it('auto-fits a column when its resizer is double-clicked', () => {
    const { container } = render(<FileList {...baseProps} />);
    const separators = container.querySelectorAll('[role="separator"]');
    const sizeCell = separators[3].parentElement as HTMLElement;

    expect(sizeCell.style.width).toBe(`${DEFAULT_COLUMN_WIDTHS.size}px`);
    fireEvent.doubleClick(separators[3]);
    expect(sizeCell.style.width).not.toBe(`${DEFAULT_COLUMN_WIDTHS.size}px`);
  });

  it('persists column widths across remounts', () => {
    const first = render(<FileList {...baseProps} />);
    const separators = first.container.querySelectorAll('[role="separator"]');
    fireEvent.doubleClick(separators[3]);
    const fitted = (separators[3].parentElement as HTMLElement).style.width;
    first.unmount();

    const second = render(<FileList {...baseProps} />);
    const separators2 = second.container.querySelectorAll('[role="separator"]');
    expect((separators2[3].parentElement as HTMLElement).style.width).toBe(fitted);
  });

  it('auto-fits a column when its label is double-clicked', () => {
    const { container } = render(<FileList {...baseProps} />);
    const nameCell = container.querySelectorAll('[role="separator"]')[0]
      .parentElement as HTMLElement;

    expect(nameCell.style.width).toBe(`${DEFAULT_COLUMN_WIDTHS.name}px`);
    fireEvent.doubleClick(nameCell);
    expect(nameCell.style.width).not.toBe(`${DEFAULT_COLUMN_WIDTHS.name}px`);
  });
});
