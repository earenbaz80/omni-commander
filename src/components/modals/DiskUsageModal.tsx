import React from 'react';
import { HardDrive, BarChart3 } from 'lucide-react';
import { Drive, FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { fsEngine } from '../../services/fileSystem';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

interface DiskUsageModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  drives: Drive[];
  onClose: () => void;
}

export const DiskUsageModal: React.FC<DiskUsageModalProps> = ({
  theme,
  lang,
  drives,
  onClose
}) => {
  const t = getTranslations(lang);
  const allFiles = (fsEngine as any).files as FileItem[];

  // Top largest files
  const topFiles = [...allFiles]
    .filter(f => !f.isDirectory)
    .sort((a, b) => b.size - a.size)
    .slice(0, 10);

  const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.diskUsageModalTitle);

  return (
    <ModalShell title={t.diskUsageTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnClose}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        <div className="p-[var(--space-4)] space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Drives capacity breakdown */}
          <div>
            <h3 className="font-bold text-amber-300 mb-[var(--space-2)] uppercase tracking-wider text-[var(--fs-sm)]">
              {t.diskConnectedDrives}
            </h3>
            <div className="space-y-[var(--space-2)].5">
              {drives.filter(d => d.isMounted).map(drive => {
                const used = drive.totalBytes - drive.freeBytes;
                const percent = Math.round((used / drive.totalBytes) * 100);

                return (
                  <div key={drive.id} className="p-[var(--space-2)].5 bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]">
                    <div className="flex items-center justify-between font-bold">
                      <span className="flex items-center gap-[var(--space-2)] text-white">
                        <HardDrive className="w-3.5 h-3.5 text-amber-400" />
                        <span>[{drive.letter}] {drive.name}</span>
                      </span>
                      <span className="tabular-nums opacity-80 text-[var(--fs-sm)]">
                        {t.diskUsedOf.replace('{size}', formatBytes(used)).replace('{total}', formatBytes(drive.totalBytes)).replace('{n}', String(percent))}
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-2.5 bg-black/60 rounded-full overflow-hidden border border-white/20">
                      <div 
                        className={`h-full transition-all ${percent > 85 ? 'bg-red-500' : percent > 60 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* TreeSize-style folder hierarchy */}
          <div>
            <h3 className="font-bold text-amber-300 mb-[var(--space-2)] uppercase tracking-wider text-[var(--fs-sm)]">TreeSize — Folder Hierarchy</h3>
            <div className="border border-white/10 rounded overflow-hidden bg-black/40 space-y-1 p-2 text-xs">
              {(fsEngine as any).getFolderSizes ? (
                (() => {
                  const root = (fsEngine as any).getFolderSizes('C:\\');
                  const renderTree = (item: any, depth = 0) => (
                    <div key={item.path} style={{ paddingLeft: depth * 12 }}>
                      <div className="flex justify-between text-white truncate hover:bg-white/10">
                        <span>📁 {item.name}</span>
                        <span className="tabular-nums text-amber-300">{(item.sizeBytes / (1024 * 1024)).toFixed(1)} MB / {item.fileCount} files</span>
                      </div>
                      {item.subFolders?.map((sub: any) => renderTree(sub, depth + 1))}
                    </div>
                  );
                  return root ? renderTree(root) : <div className="opacity-50">No data</div>;
                })()
              ) : <div className="opacity-50">Method not available</div>}
            </div>
          </div>

          {/* Top 10 Largest Files */}
          <div>
            <h3 className="font-bold text-amber-300 mb-[var(--space-2)] uppercase tracking-wider text-[var(--fs-sm)]">
              {t.diskTopFiles}
            </h3>
            <div className="border border-white/10 rounded overflow-hidden bg-black/40">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-black/60 border-b border-white/20 text-amber-300 font-bold">
                  <tr>
                    <th className="p-[var(--space-2)]">{t.file}</th>
                    <th className="p-[var(--space-2)]">{t.path}</th>
                    <th className="p-[var(--space-2)] text-right">{t.size}</th>
                  </tr>
                </thead>
                <tbody>
                  {topFiles.map((file, idx) => (
                    <tr key={file.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="p-[var(--space-2)] font-bold truncate text-white flex items-center gap-[var(--space-2)]">
                        <span className="text-[var(--fs-8)] opacity-40 tabular-nums">#{idx + 1}</span>
                        <span>{file.name}.{file.ext}</span>
                      </td>
                      <td className="p-[var(--space-2)] truncate opacity-70 text-[var(--fs-sm)]">{file.path}</td>
                      <td className="p-[var(--space-2)] text-right font-bold text-amber-300 tabular-nums">{formatBytes(file.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
