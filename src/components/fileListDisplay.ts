import { FileItem } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { getTranslations } from '../i18n/translations';
import { formatBytesCompact } from '../utils/formatBytes';

export type Translations = ReturnType<typeof getTranslations>;

/** The cursor block's hues, matching the names the settings offer. */
export const CURSOR_BLOCK_INK: Record<'amber' | 'cyan' | 'green' | 'red' | 'white', string> = {
  amber: '#fcd34d',
  cyan: '#67e8f9',
  green: '#6ee7b7',
  red: '#fca5a5',
  white: '#ffffff',
};

export const formatSize = (item: FileItem, t: Translations): string => {
  if (item.isDirectory) {
    return item.size && item.size > 0 ? formatBytesCompact(item.size) : t.directory;
  }
  return formatBytesCompact(item.size);
};

export const getItemTextColor = (item: FileItem, isSelected: boolean, theme: ThemeConfig): string => {
  if (isSelected) return theme.selectedText;
  if (item.isDirectory) return theme.dirText;
  const ext = item.ext.toUpperCase();
  if (['EXE', 'COM', 'BAT', 'CMD'].includes(ext)) return theme.exeText;
  if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ', 'ISO'].includes(ext)) return theme.zipText;
  if (['TXT', 'DOC', 'DOCX', 'PDF', 'MD'].includes(ext)) return theme.docText;
  if (['JPG', 'PNG', 'GIF', 'MP3', 'MP4', 'WAV'].includes(ext)) return theme.mediaText;
  return theme.itemText;
};

export const getItemType = (item: FileItem, t: Translations): string => {
  if (item.isDirectory) return t.folder;
  const ext = item.ext.toUpperCase();
  if (['EXE', 'COM', 'BAT', 'CMD', 'PS1', 'SH'].includes(ext)) return t.typeExecutable;
  if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ', 'ISO'].includes(ext)) return t.typeArchive;
  if (['JPG', 'JPEG', 'PNG', 'GIF', 'BMP', 'SVG', 'WEBP', 'ICO'].includes(ext)) return t.typeImage;
  if (['MP3', 'WAV', 'OGG', 'FLAC', 'AAC', 'MID'].includes(ext)) return t.typeAudio;
  if (['MP4', 'AVI', 'MKV', 'MOV', 'WMV', 'WEBM'].includes(ext)) return t.typeVideo;
  if (['TXT', 'MD', 'RTF', 'LOG', 'INI'].includes(ext)) return t.typeText;
  if (['DOC', 'DOCX', 'PDF', 'XLS', 'XLSX', 'PPT', 'PPTX'].includes(ext)) return t.typeDocument;
  if (['JS', 'TS', 'TSX', 'JSX', 'HTML', 'CSS', 'JSON', 'PY', 'C', 'CPP', 'RS', 'GO', 'SQL', 'JAVA'].includes(ext))
    return t.typeCode;
  return t.file;
};

export const formatAttributes = (item: FileItem): string => {
  const a = item.attributes;
  return `${a.readOnly ? 'R' : '.'}${a.hidden ? 'H' : '.'}${a.system ? 'S' : '.'}${a.archive ? 'A' : '.'}`;
};
