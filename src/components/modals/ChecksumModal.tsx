import React, { useState, useEffect } from 'react';
import { Hash, Copy, Check, ShieldCheck } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { fsEngine } from '../../services/fileSystem';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';

interface ChecksumModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  file: FileItem | null;
  onClose: () => void;
}

export const ChecksumModal: React.FC<ChecksumModalProps> = ({
  theme,
  lang,
  file,
  onClose
}) => {
  const t = getTranslations(lang);
  const [hashes, setHashes] = useState<{ md5: string; sha1: string; sha256: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (file) {
      fsEngine.calculateFileHashes(file).then(res => setHashes(res));
    }
  }, [file]);

  if (!file) return null;

  const handleCopy = (key: string, val: string) => {
    soundManager.playKeyTick();
    navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.checksumModalTitle);

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
            <Hash className="w-4 h-4" />
            <span>{t.hashTitle}</span>
          </div>
          <button onClick={onClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer font-bold">✕</button>
        </div>

        <div className="p-4 space-y-4">
          <div className="p-2.5 bg-black/40 rounded border border-white/10 flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-emerald-400 shrink-0" />
            <div className="truncate">
              <span className="font-bold text-white block truncate">{file.name}.{file.ext}</span>
              <span className="opacity-60 text-[11px]">{file.size.toLocaleString()} bytes • {file.modifiedAt}</span>
            </div>
          </div>

          <div className="space-y-3 select-text font-mono text-[11px]">
            {/* MD5 */}
            <div className="p-2 bg-black/30 rounded border border-white/10">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-amber-300">{t.checksumMd5}</span>
                <button
                  onClick={() => hashes && handleCopy('md5', hashes.md5)}
                  className="px-2 py-0.5 bg-white/10 hover:bg-white/20 rounded flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'md5' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'md5' ? t.copiedLabel : t.copyBtn}</span>
                </button>
              </div>
              <div className="text-white break-all">{hashes?.md5 || t.checksumCalculating}</div>
            </div>

            {/* SHA-1 */}
            <div className="p-2 bg-black/30 rounded border border-white/10">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-cyan-300">{t.checksumSha1}</span>
                <button
                  onClick={() => hashes && handleCopy('sha1', hashes.sha1)}
                  className="px-2 py-0.5 bg-white/10 hover:bg-white/20 rounded flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'sha1' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'sha1' ? t.copiedLabel : t.copyBtn}</span>
                </button>
              </div>
              <div className="text-white break-all">{hashes?.sha1 || t.checksumCalculating}</div>
            </div>

            {/* SHA-256 */}
            <div className="p-2 bg-black/30 rounded border border-white/10">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-emerald-300">{t.checksumSha256}</span>
                <button
                  onClick={() => hashes && handleCopy('sha256', hashes.sha256)}
                  className="px-2 py-0.5 bg-white/10 hover:bg-white/20 rounded flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'sha256' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'sha256' ? t.copiedLabel : t.copyBtn}</span>
                </button>
              </div>
              <div className="text-white break-all">{hashes?.sha256 || t.checksumCalculating}</div>
            </div>
          </div>

          <div className="flex items-center justify-end pt-2 border-t border-white/10">
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-bold rounded cursor-pointer"
            >
              {t.btnClose}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
