import React, { useState } from 'react';
import { FileArchive, FolderInput, FolderOutput, Shield } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';

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
  const [compressionLevel, setCompressionLevel] = useState<'fast' | 'normal' | 'ultra'>('normal');
  const [encryptArchive, setEncryptArchive] = useState(false);
  const [archivePassword, setArchivePassword] = useState('');

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
      soundManager.playSuccess();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText
        }}
      >
        <div 
          className="flex items-center justify-between px-3 py-2 border-b font-bold shrink-0"
          style={{
            backgroundColor: theme.modalHeaderBg,
            color: theme.modalHeaderText,
            borderColor: theme.modalBorder
          }}
        >
          <div className="flex items-center gap-2">
            <FileArchive className="w-4 h-4 text-fuchsia-400" />
            <span>{t.zipManagerTitle}</span>
          </div>
          <button onClick={onClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer font-bold">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Mode Switcher */}
          <div className="flex items-center gap-2 bg-black/40 p-1 rounded border border-white/10">
            <button
              type="button"
              onClick={() => setMode('pack')}
              className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1.5 cursor-pointer ${
                mode === 'pack' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10 text-white/80'
              }`}
            >
              <FolderInput className="w-3.5 h-3.5" /> {t.zipPackMode}
            </button>
            {isArchiveSelected && (
              <button
                type="button"
                onClick={() => setMode('unpack')}
                className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === 'unpack' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10 text-white/80'
                }`}
              >
                <FolderOutput className="w-3.5 h-3.5" /> {t.zipExtractMode}
              </button>
            )}
          </div>

          {mode === 'pack' ? (
            <div className="space-y-3">
              <div>
                <span className="opacity-75 block mb-1">
                  {t.zipSelectedItems.replace('{n}', String(selectedItems.length))}
                </span>
                <div className="max-h-20 overflow-y-auto bg-black/50 p-2 rounded border border-white/10 text-[11px] mb-2 text-amber-300">
                  {selectedItems.map(i => (
                    <div key={i.id} className="truncate">• {i.name}{i.ext ? `.${i.ext}` : ''}</div>
                  ))}
                </div>
              </div>

              {/* Format Selection */}
              <div>
                <label className="block font-bold text-white mb-1.5">{t.zipFormat}</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['ZIP', 'TAR', 'TAR.GZ', '7Z'] as ArchiveFormat[]).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setFormat(fmt)}
                      className={`py-1.5 rounded border text-center font-bold transition cursor-pointer ${
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

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-white mb-1">{t.zipBaseName}</label>
                  <input
                    type="text"
                    value={archiveBaseName}
                    onChange={(e) => setArchiveBaseName(e.target.value)}
                    className="w-full bg-black/50 border border-white/30 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block font-bold text-white mb-1">{t.zipLevel}</label>
                  <select
                    value={compressionLevel}
                    onChange={(e) => setCompressionLevel(e.target.value as any)}
                    className="w-full bg-black/70 border border-white/30 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none"
                  >
                    <option value="fast">{t.zipFast}</option>
                    <option value="normal">{t.zipNormal}</option>
                    <option value="ultra">{t.zipUltra}</option>
                  </select>
                </div>
              </div>

              {/* Encryption options */}
              <div className="p-2 bg-black/40 border border-white/10 rounded space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={encryptArchive}
                    onChange={e => setEncryptArchive(e.target.checked)}
                    className="rounded border-white/30"
                  />
                  <span className="text-white font-semibold flex items-center gap-1">
                    <Shield className="w-3 h-3 text-amber-400" /> {t.zipEncryptAes}
                  </span>
                </label>

                {encryptArchive && (
                  <input
                    type="password"
                    value={archivePassword}
                    onChange={e => setArchivePassword(e.target.value)}
                    placeholder={t.zipPassPlaceholder}
                    className="w-full bg-black/60 border border-amber-400/50 rounded px-2.5 py-1 text-white font-mono text-xs outline-none"
                  />
                )}
              </div>

              <div className="text-[11px] opacity-75">
                {t.zipOutput} <strong className="text-amber-300">{finalArchiveName}</strong>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="opacity-90">
                {t.zipExtractLead} <strong className="text-amber-300">{selectedItems[0]?.name}.{selectedItems[0]?.ext}</strong> {t.zipExtractInto.replace('{path}', targetPath)}
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded cursor-pointer"
            >
              {t.btnCancel}
            </button>
            <button
              type="submit"
              className="px-5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
            >
              {mode === 'pack' ? t.zipCreateBtn.replace('{format}', format.toLowerCase()) : t.zipExtractAllBtn}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
