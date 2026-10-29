import React from 'react';
import { HardDrive } from 'lucide-react';
import { DiskUsageScan, DiskUsageTopFile, Drive, FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { fsEngine } from '../../services/fileSystem';

import ModalShell from '../ModalShell';
import { DiskUsageTree } from '../DiskUsageTree';
import { formatBytes } from '../../utils/formatBytes';

interface DiskUsageModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  drives: Drive[];
  /** Drive and directory the TreeSize view is built from (the active panel). */
  driveId: string;
  rootPath: string;
  onClose: () => void;
}

export const DiskUsageModal: React.FC<DiskUsageModalProps> = ({ theme, lang, drives, driveId, rootPath, onClose }) => {
  const t = getTranslations(lang);
  const scanPath = rootPath || (driveId.startsWith('real_') ? `${driveId.slice(5)}:` : '');
  // The tree reports its finished scan so the largest-files table below can use
  // the measured answer instead of the in-memory index.
  const [scan, setScan] = React.useState<DiskUsageScan | null>(null);

  const topFiles: DiskUsageTopFile[] = scan
    ? scan.topFiles
    : [...((fsEngine as any).files as FileItem[])]
        .filter((f) => !f.isDirectory)
        .sort((a, b) => b.size - a.size)
        .slice(0, 10)
        .map((f) => ({ path: f.path, fullName: f.fullName || `${f.name}.${f.ext}`, size: f.size }));

  return (
    <ModalShell title={t.diskUsageTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnClose}>
      <div className="font-mono select-none">
        <div className="p-[var(--space-4)] space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Drives capacity breakdown */}
          <div>
            <h3 className="font-bold text-amber-300 mb-[var(--space-2)] uppercase tracking-wider text-[var(--fs-sm)]">
              {t.diskConnectedDrives}
            </h3>
            <div className="space-y-[var(--space-2)].5">
              {drives
                .filter((d) => d.isMounted)
                .map((drive) => {
                  const used = drive.totalBytes - drive.freeBytes;
                  const percent = drive.totalBytes ? Math.round((used / drive.totalBytes) * 100) : 0;

                  return (
                    <div
                      key={drive.id}
                      className="p-[var(--space-2)].5 bg-black/40 rounded border border-white/10 space-y-[var(--space-2)]"
                    >
                      <div className="flex items-center justify-between font-bold">
                        <span className="flex items-center gap-[var(--space-2)] text-white">
                          <HardDrive className="w-3.5 h-3.5 text-amber-400" />
                          <span>
                            [{drive.letter}] {drive.name}
                          </span>
                        </span>
                        <span className="tabular-nums opacity-80 text-[var(--fs-sm)]">
                          {t.diskUsedOf
                            .replace('{size}', formatBytes(used))
                            .replace('{total}', formatBytes(drive.totalBytes))
                            .replace('{n}', String(percent))}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full h-2.5 bg-black/60 rounded-full overflow-hidden border border-white/20">
                        <div
                          className={`h-full transition-all ${percent > 85 ? 'bg-red-500' : percent > 60 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                          style={{ width: `${Math.min(100, percent)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* TreeSize-style folder hierarchy */}
          <div>
            <h3 className="font-bold text-amber-300 mb-[var(--space-2)] uppercase tracking-wider text-[var(--fs-sm)]">
              {t.diskUsageTreeTitle}
            </h3>
            {scanPath && (
              <div className="text-[var(--fs-8)] opacity-60 mb-1 truncate" title={scanPath}>
                {scanPath}
              </div>
            )}
            <DiskUsageTree lang={lang} driveId={driveId} path={scanPath} onScanChange={setScan} />
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
                    <tr key={`${file.path}\\${file.fullName}`} className="border-b border-white/5 hover:bg-white/5">
                      <td className="p-[var(--space-2)] font-bold truncate text-white flex items-center gap-[var(--space-2)]">
                        <span className="text-[var(--fs-8)] opacity-40 tabular-nums">#{idx + 1}</span>
                        <span className="truncate">{file.fullName}</span>
                      </td>
                      <td className="p-[var(--space-2)] truncate opacity-70 text-[var(--fs-sm)]">{file.path}</td>
                      <td className="p-[var(--space-2)] text-right font-bold text-amber-300 tabular-nums">
                        {formatBytes(file.size)}
                      </td>
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
