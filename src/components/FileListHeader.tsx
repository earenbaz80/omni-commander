import React, { useEffect, useRef } from 'react';
import { FileItem, SortField, SortDirection, ViewMode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { autoFitWidth, MIN_COLUMN_WIDTH } from '../utils/columnWidths';
import { formatSize, getItemType, type Translations } from './fileListDisplay';

interface FileListHeaderProps {
  theme: ThemeConfig;
  t: Translations;
  items: FileItem[];
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  colWidths: Record<string, number>;
  setColWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  onSort: (field: SortField) => void;
}

/**
 * The column labels and their drag handles. Widths live in FileList because the
 * rows read them too; this component owns the drag that changes them.
 */
export const FileListHeader: React.FC<FileListHeaderProps> = ({
  theme,
  t,
  items,
  viewMode,
  sortField,
  sortDirection,
  colWidths,
  setColWidths,
  onSort,
}) => {
  const resizingColumnRef = useRef<string | null>(null);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingColumnRef.current) return;
      const delta = e.clientX - resizeStartXRef.current;
      const next = Math.max(MIN_COLUMN_WIDTH, resizeStartWidthRef.current + delta);
      setColWidths((prev) => ({ ...prev, [resizingColumnRef.current as string]: next }));
    };
    const onUp = () => {
      resizingColumnRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setColWidths]);

  const startResizeColumn = (key: string, e: React.MouseEvent) => {
    resizingColumnRef.current = key;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = colWidths[key];
    e.preventDefault();
    e.stopPropagation();
  };
  const autoSizeColumn = (key: string) => {
    const samples: Record<string, string[]> = {
      name: [...items.map((i) => i.name), t.name],
      ext: [...items.map((i) => i.ext), t.ext],
      type: [...items.map((i) => getItemType(i, t)), t.colType],
      size: [...items.map((i) => formatSize(i, t)), t.size],
      date: ['0000-00-00 00:00', t.date],
      attr: ['RWA', t.attr],
    };
    setColWidths((p) => ({ ...p, [key]: autoFitWidth(samples[key] ?? ['']) }));
  };

  // Small visible divider between column labels: drag to resize, double-click to auto-fit.
  const renderResizer = (colKey: string, label: string) => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t.fileListResizeColumn.replace('{label}', String(label))}
      title={t.fileListResizeHint}
      onMouseDown={(e) => startResizeColumn(colKey, e)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        autoSizeColumn(colKey);
      }}
      className="nc-col-resizer"
    />
  );

  return (
    <div
      className="flex items-center min-w-full px-[var(--space-2)] py-[var(--space-1)] border-b select-none font-bold text-[11px] shrink-0 uppercase tracking-wider gap-0 whitespace-nowrap flex-nowrap"
      style={{
        backgroundColor: theme.headerBg,
        color: theme.headerText,
        borderColor: theme.borderPanel,
      }}
    >
      <div
        onClick={() => onSort('name')}
        onDoubleClick={() => autoSizeColumn('name')}
        className="flex items-center cursor-pointer hover:opacity-80 transition-opacity shrink-0 relative pr-1"
        style={{ width: `${colWidths.name}px`, minWidth: '44px' }}
      >
        <span className="truncate">{t.name}</span>
        {sortField === 'name' && <span className="ml-1 text-[10px]">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
        {viewMode === 'full' && renderResizer('name', t.name)}
      </div>

      {viewMode === 'full' && (
        <>
          <div
            onClick={() => onSort('ext')}
            onDoubleClick={() => autoSizeColumn('ext')}
            className="text-center cursor-pointer hover:opacity-80 transition-opacity shrink-0 relative"
            style={{ width: `${colWidths.ext}px`, minWidth: '44px' }}
          >
            <span>{t.ext}</span>
            {sortField === 'ext' && <span className="ml-0.5 text-[10px]">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
            {renderResizer('ext', t.ext)}
          </div>
          <div
            onDoubleClick={() => autoSizeColumn('type')}
            className="text-left shrink-0 px-1 opacity-90 font-semibold relative"
            style={{ width: `${colWidths.type}px`, minWidth: '72px' }}
          >
            {t.colType}
            {renderResizer('type', t.colType)}
          </div>

          <div
            onClick={() => onSort('size')}
            onDoubleClick={() => autoSizeColumn('size')}
            className="text-right cursor-pointer hover:opacity-80 transition-opacity shrink-0 px-1 relative"
            style={{ width: `${colWidths.size}px`, minWidth: '64px' }}
          >
            <span>{t.size}</span>
            {sortField === 'size' && <span className="ml-0.5 text-[10px]">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
            {renderResizer('size', t.size)}
          </div>

          <div
            onClick={() => onSort('modifiedAt')}
            onDoubleClick={() => autoSizeColumn('date')}
            className="text-center cursor-pointer hover:opacity-80 transition-opacity shrink-0 relative"
            style={{ width: `${colWidths.date}px`, minWidth: '96px' }}
          >
            <span>{t.date}</span>
            {sortField === 'modifiedAt' && (
              <span className="ml-0.5 text-[10px]">{sortDirection === 'asc' ? '▲' : '▼'}</span>
            )}
            {renderResizer('date', t.date)}
          </div>

          <div
            onDoubleClick={() => autoSizeColumn('attr')}
            className="text-center shrink-0 hidden sm:block relative"
            style={{ width: `${colWidths.attr}px`, minWidth: '44px' }}
          >
            <span>{t.attr}</span>
            {renderResizer('attr', t.attr)}
          </div>
        </>
      )}

      <div className="flex-1" />
    </div>
  );
};
