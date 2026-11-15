import React from 'react';
import { FileTypeIcon, fileIconColor, fileIconKind } from './FileTypeIcon';
import { FileItem } from '../types';
import { ThemeConfig } from '../services/themeManager';

/**
 * The listing draws its own glyphs so they carry the theme's colours; see
 * FileTypeIcon for why the icon library was dropped from this column.
 */
export const FileIcon: React.FC<{
  item: FileItem;
  theme: ThemeConfig;
  size?: string;
  style?: React.CSSProperties;
}> = ({ item, theme, size = 'w-3.5 h-3.5', style }) => {
  const kind = fileIconKind(item);
  return <FileTypeIcon kind={kind} color={fileIconColor(kind, theme)} className={`${size} shrink-0`} style={style} />;
};
