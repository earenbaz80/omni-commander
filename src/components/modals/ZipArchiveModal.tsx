import React, { useState } from 'react';
import { FolderInput, FolderOutput } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

interface ZipArchiveModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  selectedItems: FileItem[];
  targetDriveId: string;
  targetPath: string;
  onCompress: (archiveName: string) => void;
  onExtract: (zipFile: FileItem) => void;
  onClose: () => void;
}

export type ArchiveFormat = 'ZIP' | 'TAR' | 'TAR.GZ' | '7Z';

export const ZipArchiveModal: React.FC<ZipArchiveModalProps> = ({
  theme,
  lang,
  selectedItems,
  targetPath,
  onCompress,
  onExtract,
  onClose
}) => {
  const t = getTranslations(lang);
  const isArchiveSelected = selectedItems.length === 1 && ['ZIP', 'TAR', 'GZ', 'TGZ', '7Z', 'RAR'].includes(selectedItems[0].ext.toUpperCase());
  const [mode, setMode] = useState<'pack' | 'unpack'>(isArchiveSelected ? 'unpack' : 'pack');
  const [format, setFormat] = useState<ArchiveFormat>('ZIP');

  const getExtensionForFormat = (fmt: ArchiveFormat) => {
    switch (fmt) {
      case 'TAR': return 'tar';
      case 'TAR.GZ': return 'tar.gz';
      case '7Z': return '7z';
      default: return 'zip';
    }
  };

  const baseName = selectedItems.length === 1 ? selectedItems[0].name : 'Archive_Package';
  const [archiveBaseName, setArchiveBaseName] = useState(baseName);

  const finalArchiveName = `${archiveBaseName}.${getExtensionForFormat(format)}`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'pack') {
      onCompress(finalArchiveName);
    } else {
      if (selectedItems[0]) {
        soundManager.playDiskAccess();
        onExtract(selectedItems[0]);
      }
    }
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.zipModalTitle);

  return (
    <ModalShell title={t.zipManagerTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        <form onSubmit={handleSubmit} className="p-[var(--space-4)] space-y-[var(--space-4)]">
          {/* Mode Switcher */}
          <div className="flex items-center gap-[var(--space-2)] bg-black/40 p-[var(--space-1)] rounded border border-white/10">
            <button
              type="button"
              onClick={() => setMode('pack')}
              className={`flex-1 py-[var(--space-2)] rounded flex items-center justify-center gap-[var(--space-2)] cursor-pointer ${
                mode === 'pack' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10 text-white/80'
              }`}
            >
              <FolderInput className="w-3.5 h-3.5" /> {t.zipPackMode}
            </button>
            {isArchiveSelected && (
              <button
                type="button"
                onClick={() => setMode('unpack')}
                className={`flex-1 py-[var(--space-2)] rounded flex items-center justify-center gap-[var(--space-2)] cursor-pointer ${
                  mode === 'unpack' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10 text-white/80'
                }`}
              >
                <FolderOutput className="w-3.5 h-3.5" /> {t.zipExtractMode}
              </button>
            )}
          </div>

          {mode === 'pack' ? (
            <div className="space-y-[var(--space-3)]">
              <div>
                <span className="opacity-75 block mb-[var(--space-1)]">
                  {t.zipSelectedItems.replace('{n}', String(selectedItems.length))}
                </span>
                <div className="max-h-20 overflow-y-auto bg-black/50 p-[var(--space-2)] rounded border border-white/10 text-[11px] mb-[var(--space-2)] text-amber-300">
                  {selectedItems.map(i => (
                    <div key={i.id} className="truncate">• {i.name}{i.ext ? `.${i.ext}` : ''}</div>
                  ))}
                </div>
              </div>

              {/* Format Selection */}
              <div>
                <label className="block font-bold text-white mb-[var(--space-1)].5">{t.zipFormat}</label>
                <div className="grid grid-cols-4 gap-[var(--space-2)]">
                  {(['ZIP'] as ArchiveFormat[]).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setFormat(fmt)}
                      className={`py-[var(--space-2)] rounded border text-center font-bold transition cursor-pointer ${
                        format === fmt
                          ? 'bg-fuchsia-600 text-white border-fuchsia-400 shadow'
                          : 'bg-black/40 border-white/20 hover:bg-white/10 text-white/70'
                      }`}
                    >
                      .{fmt.toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-[var(--space-2)]">
                <div>
                  <label className="block font-bold text-white mb-[var(--space-1)]">{t.zipBaseName}</label>
                  <input
                    type="text"
                    value={archiveBaseName}
                    onChange={(e) => setArchiveBaseName(e.target.value)}
                    className="w-full bg-black/50 border border-white/30 rounded px-[var(--space-3)] py-[var(--space-2)] text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none"
                    autoFocus
                  />
                </div>
              </div>

              <p className="text-[11px] opacity-75">{t.zipUnsupported}</p>

              <div className="text-[11px] opacity-75">
                {t.zipOutput} <strong className="text-amber-300">{finalArchiveName}</strong>
              </div>
            </div>
          ) : (
            <div className="space-y-[var(--space-2)]">
              <p className="opacity-90">
                {t.zipExtractLead} <strong className="text-amber-300">{selectedItems[0]?.name}.{selectedItems[0]?.ext}</strong> {t.zipExtractInto.replace('{path}', targetPath)}
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-[var(--space-2)] pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-[var(--space-4)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded cursor-pointer"
            >
              {t.btnCancel}
            </button>
            <button
              type="submit"
              className="px-5 py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
            >
              {mode === 'pack' ? t.zipCreateBtn.replace('{format}', format.toLowerCase()) : t.zipExtractAllBtn}
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
};
