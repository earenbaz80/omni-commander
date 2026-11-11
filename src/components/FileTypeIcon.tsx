import React from 'react';
import type { FileItem } from '../types';
import type { ThemeConfig } from '../services/themeManager';

/**
 * The file-type glyphs are drawn here instead of borrowed from an icon library.
 *
 * The listing used to mix library shapes with fixed Tailwind hues — pink-400
 * audio, rose-400 video, purple-400 images and packages — so every theme ended
 * up with a second palette on top of its own, and the retro-futurist panel
 * carried the magenta and pink it never asked for. These glyphs are one family:
 * a 16×16 grid, half-pixel strokes that stay crisp at 14 px, square caps and no
 * curves. Their colour comes from the active ThemeConfig, because a file's icon
 * and the name printed next to it should never disagree.
 *
 * Folders are the exception in kind, not in source: `folderText` is the one
 * entry a theme tunes to keep a directory looking like one — amber in the
 * warm palettes, lime in Matrix, Solarized's yellow in Solarized — while the
 * name beside it keeps the theme's directory colour.
 */
export type FileIconKind =
  'folder' | 'exec' | 'archive' | 'disk' | 'document' | 'code' | 'image' | 'audio' | 'video' | 'file';

const EXEC_EXT = ['EXE', 'COM', 'BAT', 'CMD', 'SH', 'PS1'];
const ARCHIVE_EXT = ['ZIP', 'RAR', 'R00', 'R01', 'R10', 'R99', '7Z', '7ZIP', 'TAR', 'TGZ', 'TBZ2', 'TZ', 'TAZ'];
const DISK_EXT = ['GZ', 'ISO'];
const DOCUMENT_EXT = ['TXT', 'DOC', 'DOCX', 'PDF', 'MD', 'RTF'];
const CODE_EXT = ['JS', 'TS', 'TSX', 'JSX', 'HTML', 'CSS', 'JSON', 'PY', 'C', 'CPP', 'RS', 'GO', 'SQL'];
const IMAGE_EXT = ['JPG', 'JPEG', 'PNG', 'GIF', 'BMP', 'SVG', 'WEBP', 'ICO'];
const AUDIO_EXT = ['MP3', 'WAV', 'OGG', 'FLAC', 'AAC', 'MID'];
const VIDEO_EXT = ['MP4', 'AVI', 'MKV', 'MOV', 'WMV', 'WEBM'];

/** Which glyph a listing entry earns. Directories win over their extension. */
export function fileIconKind(item: Pick<FileItem, 'isDirectory' | 'ext'>): FileIconKind {
  if (item.isDirectory) return 'folder';
  const ext = (item.ext || '').toUpperCase();
  if (EXEC_EXT.includes(ext)) return 'exec';
  if (ARCHIVE_EXT.includes(ext)) return 'archive';
  if (DISK_EXT.includes(ext)) return 'disk';
  if (DOCUMENT_EXT.includes(ext)) return 'document';
  if (CODE_EXT.includes(ext)) return 'code';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return 'file';
}

/**
 * The theme colour each kind is drawn in. It follows the same split the list
 * already uses for names, so a folder icon and its cyan label match, archives
 * and their amber label match, and so on.
 */
export function fileIconColor(kind: FileIconKind, theme: ThemeConfig): string {
  switch (kind) {
    case 'folder':
      return theme.folderText;
    case 'exec':
      return theme.exeText;
    case 'archive':
    case 'disk':
      return theme.zipText;
    case 'document':
      return theme.docText;
    case 'code':
      return theme.accent;
    case 'image':
    case 'audio':
    case 'video':
      return theme.mediaText;
    default:
      return theme.itemText;
  }
}

const GLYPHS: Record<FileIconKind, (color: string) => React.ReactNode> = {
  folder: (color) => (
    <>
      <path d="M1.5 13.5V2.5h5l2 2h6v9z" fill={color} fillOpacity={0.3} />
      <path d="M1.5 13.5V2.5h5l2 2h6v9z" />
      <path d="M3.5 9.5h6" strokeOpacity={0.55} />
    </>
  ),
  exec: () => (
    <>
      <path d="M1.5 2.5h13v11h-13z" />
      <path d="M1.5 5.5h13" strokeOpacity={0.55} />
      <path d="M4.5 8l2 2-2 2" />
      <path d="M8.5 12h3.5" />
    </>
  ),
  archive: (color) => (
    <>
      <path d="M1.5 4.5h13v9h-13z" />
      <path d="M1.5 7.5h13" strokeOpacity={0.55} />
      <path d="M7 7.5h2v4h-2z" fill={color} fillOpacity={0.75} />
      <path d="M6 4.5h4" />
    </>
  ),
  disk: () => (
    <>
      <path d="M1.5 2.5h13v11h-13z" />
      <path d="M9.5 2.5v3.5h3v-3.5" />
      <path d="M3.5 9.5h9v4h-9z" strokeOpacity={0.55} />
    </>
  ),
  document: () => (
    <>
      <path d="M3.5 1.5h6l3 3v10h-9z" />
      <path d="M9.5 1.5v3h3" />
      <path d="M5.5 7.5h5.5M5.5 9.5h5.5M5.5 11.5h3.5" strokeOpacity={0.55} />
    </>
  ),
  code: () => (
    <>
      <path d="M6.5 3l-4 5 4 5" />
      <path d="M9.5 3l4 5-4 5" />
      <path d="M9.5 2.5l-3 11" strokeOpacity={0.55} />
    </>
  ),
  image: (color) => (
    <>
      <path d="M1.5 2.5h13v11h-13z" />
      <path d="M4 5h2v2h-2z" fill={color} fillOpacity={0.75} />
      <path d="M2.5 12.5l3.5-3.5 2.5 2.5 2-2 3 3" />
    </>
  ),
  audio: (color) => (
    <>
      <path d="M1 10h2v4H1zM4 5h2v9H4zM7 1h2v13H7zM10 7h2v7h-2zM13 9h2v5h-2z" fill={color} fillOpacity={0.8} />
    </>
  ),
  video: (color) => (
    <>
      <path d="M1.5 2.5h13v11h-13z" />
      <path d="M6.5 5.5l4.5 2.5-4.5 2.5z" fill={color} fillOpacity={0.75} />
    </>
  ),
  file: () => (
    <>
      <path d="M3.5 1.5h6l3 3v10h-9z" />
      <path d="M9.5 1.5v3h3" />
    </>
  ),
};

/**
 * One glyph, drawn in the colour its kind belongs to in the current theme.
 * `className` and `style` are the sizing hooks the listing already passes, so
 * call sites keep their 14 px rows and their larger thumbnail cells.
 */
export const FileTypeIcon: React.FC<{
  kind: FileIconKind;
  color: string;
  className?: string;
  style?: React.CSSProperties;
}> = ({ kind, color, className, style }) => (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    className={className}
    style={style}
    fill="none"
    stroke={color}
    strokeWidth={1}
    strokeLinecap="square"
    strokeLinejoin="miter"
    shapeRendering="crispEdges"
    aria-hidden="true"
    focusable="false"
    data-file-icon={kind}
  >
    {GLYPHS[kind](color)}
  </svg>
);
