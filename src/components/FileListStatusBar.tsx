import React from 'react';
import { ThemeConfig } from '../services/themeManager';

interface FileListStatusBarProps {
  theme: ThemeConfig;
  totalFiles: number;
  totalDirs: number;
  selectedCount: number;
  selectedBytes: number;
  totalBytes: number;
  filesCountLabel: string;
  dirsCountLabel: string;
  selectedCountLabel: string;
}

export const FileListStatusBar: React.FC<FileListStatusBarProps> = ({
  theme,
  totalFiles,
  totalDirs,
  selectedCount,
  selectedBytes,
  totalBytes,
  filesCountLabel,
  dirsCountLabel,
  selectedCountLabel,
}) => (
  <div
    className="px-[var(--space-2)] py-[var(--space-1)] border-t text-[11px] select-none flex items-center justify-between shrink-0 font-mono"
    style={{
      backgroundColor: theme.headerBg,
      color: theme.headerText,
      borderColor: theme.borderPanel,
    }}
  >
    <div className="flex items-center gap-[var(--space-2)] truncate">
      <span>
        {totalFiles} {filesCountLabel}
      </span>
      <span className="opacity-50">|</span>
      <span>
        {totalDirs} {dirsCountLabel}
      </span>
      {selectedCount > 0 && (
        <>
          <span className="opacity-50">|</span>
          <span className="font-extrabold text-amber-900 bg-amber-400 px-1 rounded-[2px]">
            {selectedCount} {selectedCountLabel} ({Math.round(selectedBytes / 1024)} kB)
          </span>
        </>
      )}
    </div>
    <div className="tabular-nums font-bold">{Math.round(totalBytes / 1024)} kB total</div>
  </div>
);
