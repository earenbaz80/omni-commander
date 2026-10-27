import React, { useState } from 'react';
import { FileArchive, FolderOpen, Package, Copy, X } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

interface ArchiveInfoModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  fileName: string;
  formatInfo?: {
    format: string;
    encrypted?: boolean;
    passwordRequired?: boolean;
  };
  fileSize: number;
  fileDate: Date;
  onExtractAll: () => void;
  onExtractSelected: () => void;
  onClose: () => void;
}

export const ArchiveInfoModal: React.FC<ArchiveInfoModalProps> = ({
  theme,
  lang,
  fileName,
  formatInfo,
  fileSize,
  fileDate,
  onExtractAll,
  onExtractSelected,
  onClose,
}) => {
  const t = getTranslations(lang);
  const dialogRef = useModalDialog<HTMLDivElement>(t.zipTitle); // Usar traducción existente

  const formatLabel = () => {
    if (!formatInfo?.format) return 'ZIP';

    switch (formatInfo.format.toUpperCase()) {
      case 'ZIP':
        return 'ZIP Archive';
      case 'RAR':
        return formatInfo.format.includes('v5') ? 'RAR v5' : 'RAR v4';
      case '7Z':
        return '7-Zip';
      case 'TAR':
        return formatInfo.format || 'TAR';
      default:
        return formatInfo.format;
    }
  };

  return (
    <ModalShell title={t.zipTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        <div className="p-[var(--space-5)] space-y-[var(--space-5)]">
          {/* Header */}
          <div className="flex items-start gap-[var(--space-3)] opacity-90">
            <FileArchive className="w-6 h-6 text-purple-400 shrink-0" />
            <div>
              <h3 className="text-sm font-bold">{fileName}</h3>
              <span className="inline-flex items-center gap-[var(--space-1)] px-[var(--space-2)].5 py-[var(--space-1)] rounded-full text-[10px] font-bold border bg-purple-500/20 text-purple-300 border-purple-400/30">
                {formatLabel()}
              </span>
            </div>
          </div>

          {/* Details */}
          <div className="grid grid-cols-[auto_1fr] gap-x-[var(--space-4)] gap-y-[var(--space-2)].5 text-xs opacity-80">
            <span>Size:</span>
            <span>{(fileSize / 1024 / 1024).toFixed(2)} MB</span>

            <span>Date:</span>
            <span>{fileDate.toLocaleString()}</span>
          </div>

          {/* Actions */}
          <div className="border-t border-white/10 pt-[var(--space-4)] space-y-[var(--space-2)]">
            {formatInfo?.format === 'ZIP' || formatInfo?.format === 'RAR' || formatInfo?.format === '7Z' ? (
              <>
                <button
                  onClick={onExtractAll}
                  className="w-full px-4 py-[var(--space-3)] bg-gradient-to-r from-purple-500/80 to-pink-500/80 hover:from-purple-400/90 hover:to-pink-400/90 text-white font-bold rounded flex items-center justify-center gap-[var(--space-2)] transition-all shadow-lg"
                >
                  <Package className="w-4 h-4" />
                  {t.zipExtractAllBtn} (E)
                </button>

                <button
                  onClick={onExtractSelected}
                  className="w-full px-4 py-[var(--space-2)] bg-white/10 hover:bg-white/20 text-white font-semibold rounded flex items-center justify-center gap-[var(--space-2)] transition-all"
                >
                  <FolderOpen className="w-4 h-4" />
                  Extract Selected (S)
                </button>
              </>
            ) : null}

            {/* Copy path option */}
            <button
              onClick={() => {
                navigator.clipboard.writeText(fileName).catch(() => {});
                alert('Path copied to clipboard');
              }}
              className="w-full px-4 py-[var(--space-2)] bg-white/10 hover:bg-white/20 text-white font-semibold rounded flex items-center justify-center gap-[var(--space-2)] transition-all"
            >
              <Copy className="w-4 h-4" />
              Copy Path
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
