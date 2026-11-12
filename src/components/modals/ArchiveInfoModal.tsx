import React from 'react';
import { FileArchive, Package, Copy } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { formatFromExtension, formatLabel, isOpenable } from '../../services/archiveBackend';
import { formatBytes } from '../../utils/formatBytes';

import ModalShell from '../ModalShell';

interface ArchiveInfoModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  fileName: string;
  fileSize: number;
  fileDate: Date;
  onExtractAll: () => void;
  onClose: () => void;
}

export const ArchiveInfoModal: React.FC<ArchiveInfoModalProps> = ({
  theme,
  lang,
  fileName,
  fileSize,
  fileDate,
  onExtractAll,
  onClose,
}) => {
  const t = getTranslations(lang);
  // The format comes from the name the user selected, never from a guess: the
  // window used to offer "Extract All" for RAR and 7Z too, and both ended in a
  // corrupt-archive error because no reader exists for them.
  const format = formatFromExtension(fileName);
  const canExtract = isOpenable(format);

  return (
    <ModalShell title={t.zipTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div className="font-mono select-none">
        <div className="p-[var(--space-5)] space-y-[var(--space-5)]">
          {/* Header */}
          <div className="flex items-start gap-[var(--space-3)] opacity-90">
            <FileArchive className="w-6 h-6 text-purple-400 shrink-0" />
            <div>
              <h3 className="text-sm font-bold">{fileName}</h3>
              <span className="inline-flex items-center gap-[var(--space-1)] px-[var(--space-2)].5 py-[var(--space-1)] rounded-full text-[10px] font-bold border bg-purple-500/20 text-purple-300 border-purple-400/30">
                {formatLabel(format)}
              </span>
            </div>
          </div>

          {/* Details */}
          <div className="grid grid-cols-[auto_1fr] gap-x-[var(--space-4)] gap-y-[var(--space-2)].5 text-xs opacity-80">
            <span>{t.sizeLabel}</span>
            <span>{formatBytes(fileSize)}</span>

            <span>{t.dateLabel}</span>
            <span>{fileDate.toLocaleString()}</span>
          </div>

          {/* Actions */}
          <div className="border-t border-white/10 pt-[var(--space-4)] space-y-[var(--space-2)]">
            {canExtract ? (
              <button
                onClick={onExtractAll}
                className="w-full px-4 py-[var(--space-3)] bg-gradient-to-r from-purple-500/80 to-pink-500/80 hover:from-purple-400/90 hover:to-pink-400/90 text-white font-bold rounded flex items-center justify-center gap-[var(--space-2)] transition-all shadow-lg"
              >
                <Package className="w-4 h-4" />
                {t.zipExtractAllBtn}
              </button>
            ) : (
              <p className="text-xs nc-warn-ink">{t.zipInfoUnsupported.replace('{format}', formatLabel(format))}</p>
            )}

            {/* Copy path option */}
            <button
              onClick={() => {
                navigator.clipboard.writeText(fileName).catch(() => {});
                alert(t.copied);
              }}
              className="w-full px-4 py-[var(--space-2)] bg-white/10 hover:bg-white/20 text-white font-semibold rounded flex items-center justify-center gap-[var(--space-2)] transition-all"
            >
              <Copy className="w-4 h-4" />
              {t.copyBtn}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
