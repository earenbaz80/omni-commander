import React, { useState } from 'react';
import { Info, FileText, Folder } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';

interface PropertiesModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  file: FileItem | null;
  onUpdateAttributes: (fileId: string, attributes: FileItem['attributes']) => void;
  onClose: () => void;
}

export const PropertiesModal: React.FC<PropertiesModalProps> = ({
  theme,
  lang,
  file,
  onUpdateAttributes,
  onClose
}) => {
  const t = getTranslations(lang);
  const [attributes, setAttributes] = useState(
    file?.attributes || { readOnly: false, hidden: false, system: false, archive: true }
  );

  if (!file) return null;

  const handleToggle = (key: keyof FileItem['attributes']) => {
    soundManager.playKeyTick();
    const updated = { ...attributes, [key]: !attributes[key] };
    setAttributes(updated);
    onUpdateAttributes(file.id, updated);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB (${bytes.toLocaleString()} bytes)`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB (${bytes.toLocaleString()} bytes)`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB (${bytes.toLocaleString()} bytes)`;
    return `${bytes.toLocaleString()} bytes`;
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.properties);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded shadow-2xl border text-xs overflow-hidden"
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
            <Info className="w-4 h-4" />
            <span>{t.properties}: {file.name}.{file.ext}</span>
          </div>
          <button onClick={onClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer font-bold">✕</button>
        </div>

        <div className="p-4 space-y-4 font-mono text-xs">
          {/* Header Icon + Name */}
          <div className="flex items-center gap-3 pb-3 border-b border-white/10">
            <div className="w-10 h-10 rounded bg-black/40 border border-white/20 flex items-center justify-center">
              {file.isDirectory ? <Folder className="w-6 h-6 text-amber-400" /> : <FileText className="w-6 h-6 text-sky-400" />}
            </div>
            <div className="truncate">
              <span className="font-bold text-white text-sm block truncate">{file.name}{file.ext ? `.${file.ext}` : ''}</span>
              <span className="opacity-60 text-[11px]">{file.isDirectory ? t.propFolderDirectory : `${t.file} .${file.ext || 'DAT'}`}</span>
            </div>
          </div>

          {/* Details Table */}
          <div className="space-y-1.5 opacity-90 text-[11px]">
            <div className="flex"><span className="w-28 opacity-60">{t.propLocation}</span> <span className="text-white truncate">{file.path}</span></div>
            <div className="flex"><span className="w-28 opacity-60">{t.sizeLabel}</span> <span className="text-white">{formatBytes(file.size)}</span></div>
            <div className="flex"><span className="w-28 opacity-60">{t.propSizeOnDisk}</span> <span className="text-white">{formatBytes(Math.ceil(Math.max(file.size, 4096) / 4096) * 4096)}</span></div>
            <div className="flex"><span className="w-28 opacity-60">{t.createdLabel}</span> <span className="text-white">{file.createdAt}</span></div>
            <div className="flex"><span className="w-28 opacity-60">{t.modifiedLabel}</span> <span className="text-white">{file.modifiedAt}</span></div>
          </div>

          {/* Attributes Checkboxes */}
          <div className="pt-2 border-t border-white/10">
            <span className="font-bold text-amber-300 block mb-2">{t.propAttributesNtfs}</span>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attributes.readOnly}
                  onChange={() => handleToggle('readOnly')}
                />
                <span>{t.propReadOnly}</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attributes.hidden}
                  onChange={() => handleToggle('hidden')}
                />
                <span>{t.propHidden}</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attributes.archive}
                  onChange={() => handleToggle('archive')}
                />
                <span>{t.propArchive}</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attributes.system}
                  onChange={() => handleToggle('system')}
                />
                <span>{t.propSystem}</span>
              </label>
            </div>
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
            <button
              onClick={onClose}
              className="px-5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
            >
              {t.btnOk}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
