import React, { useState, useEffect } from 'react';
import { Hash, Copy, Check, ShieldCheck } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { fsEngine } from '../../services/fileSystem';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

interface ChecksumModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  file: FileItem | null;
  onClose: () => void;
}

export const ChecksumModal: React.FC<ChecksumModalProps> = ({ theme, lang, file, onClose }) => {
  const t = getTranslations(lang);
  const [hashes, setHashes] = useState<{ md5: string; sha1: string; sha256: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setHashes(null);
    setError(null);
    fsEngine
      .calculateFileHashes(file)
      .then((res) => {
        if (!cancelled) setHashes(res);
      })
      .catch((err) => {
        if (cancelled) return;
        // Never render a fake digest: show why the real one is unavailable.
        setError(err && err.message ? String(err.message) : 'Could not read the file bytes');
      });
    return () => {
      cancelled = true;
    };
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
    <ModalShell title={t.checksumModalTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnClose}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        <div className="p-[var(--space-4)] space-y-[var(--space-4)]">
          <div className="p-[var(--space-2)].5 bg-black/40 rounded border border-white/10 flex items-center gap-[var(--space-3)]">
            <ShieldCheck className="w-8 h-8 text-emerald-400 shrink-0" />
            <div className="truncate">
              <span className="font-bold text-white block truncate">
                {file.name}.{file.ext}
              </span>
              <span className="opacity-60 text-[var(--fs-sm)]">
                {file.size.toLocaleString()} bytes • {file.modifiedAt}
              </span>
            </div>
          </div>

          {error && (
            <div className="p-[var(--space-2)] bg-red-500/15 rounded border border-red-500/40 text-red-300 text-[var(--fs-sm)] break-words">
              {error}
            </div>
          )}

          <div className="space-y-[var(--space-3)] select-text font-mono text-[var(--fs-sm)]">
            {/* MD5 */}
            <div className="p-[var(--space-2)] bg-black/30 rounded border border-white/10">
              <div className="flex items-center justify-between mb-[var(--space-1)]">
                <span className="font-bold text-amber-300">{t.checksumMd5}</span>
                <button
                  onClick={() => hashes && handleCopy('md5', hashes.md5)}
                  className="px-[var(--space-2)] py-[var(--space-1)] bg-white/10 hover:bg-white/20 rounded flex items-center gap-[var(--space-1)] cursor-pointer"
                >
                  {copiedKey === 'md5' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'md5' ? t.copiedLabel : t.copyBtn}</span>
                </button>
              </div>
              <div className="text-white break-all">{hashes?.md5 || (error ? '—' : t.checksumCalculating)}</div>
            </div>

            {/* SHA-1 */}
            <div className="p-[var(--space-2)] bg-black/30 rounded border border-white/10">
              <div className="flex items-center justify-between mb-[var(--space-1)]">
                <span className="font-bold text-cyan-300">{t.checksumSha1}</span>
                <button
                  onClick={() => hashes && handleCopy('sha1', hashes.sha1)}
                  className="px-[var(--space-2)] py-[var(--space-1)] bg-white/10 hover:bg-white/20 rounded flex items-center gap-[var(--space-1)] cursor-pointer"
                >
                  {copiedKey === 'sha1' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'sha1' ? t.copiedLabel : t.copyBtn}</span>
                </button>
              </div>
              <div className="text-white break-all">{hashes?.sha1 || (error ? '—' : t.checksumCalculating)}</div>
            </div>

            {/* SHA-256 */}
            <div className="p-[var(--space-2)] bg-black/30 rounded border border-white/10">
              <div className="flex items-center justify-between mb-[var(--space-1)]">
                <span className="font-bold text-emerald-300">{t.checksumSha256}</span>
                <button
                  onClick={() => hashes && handleCopy('sha256', hashes.sha256)}
                  className="px-[var(--space-2)] py-[var(--space-1)] bg-white/10 hover:bg-white/20 rounded flex items-center gap-[var(--space-1)] cursor-pointer"
                >
                  {copiedKey === 'sha256' ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copiedKey === 'sha256' ? t.copiedLabel : t.copyBtn}</span>
                </button>
              </div>
              <div className="text-white break-all">{hashes?.sha256 || (error ? '—' : t.checksumCalculating)}</div>
            </div>
          </div>

          <div className="flex items-center justify-end pt-2 border-t border-white/10">
            <button
              onClick={onClose}
              className="px-[var(--space-4)] py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-bold rounded cursor-pointer"
            >
              {t.btnClose}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
