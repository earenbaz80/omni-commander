import React from 'react';
import { HardDriveDownload } from 'lucide-react';
import { FreeSpaceVolume, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';

import { useModalDialog } from '../../hooks/useModalDialog';

interface FreeSpaceModalProps {
  volumes: FreeSpaceVolume[];
  theme: ThemeConfig;
  lang: LanguageCode;
  /** Start the transfer anyway; the server reports ENOSPC if the disk really is full. */
  onForce: () => void;
  onCancel: () => void;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/**
 * Last stop before a transfer that does not fit. The numbers come from the
 * server: it walks the source trees and reads each target volume, so "Size" is
 * what the copy will actually write, folders included.
 *
 * Force is deliberately available: a volume can free room while the copy runs
 * (a move deletes as it goes, a temporary file disappears), and refusing
 * outright would take that decision away from the user.
 */
export const FreeSpaceModal: React.FC<FreeSpaceModalProps> = ({ volumes, theme, lang, onForce, onCancel }) => {
  const t = getTranslations(lang);
  const dialogRef = useModalDialog<HTMLDivElement>(t.freeSpaceTitle);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-[var(--space-4)] font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="flex flex-col rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText,
          width: '38rem',
          maxWidth: '100%',
        }}
      >
        <div
          className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-b font-bold shrink-0"
          style={{
            backgroundColor: theme.modalHeaderBg,
            color: theme.modalHeaderText,
            borderColor: theme.modalBorder,
          }}
        >
          <div className="flex items-center gap-[var(--space-2)] min-w-0">
            <HardDriveDownload className="w-4 h-4 shrink-0" />
            <span className="truncate">{t.freeSpaceTitle}</span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="px-[var(--space-2)] py-[var(--space-1)] bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer"
            aria-label={t.btnCancel}
          >
            ✕
          </button>
        </div>

        <div className="p-[var(--space-4)] flex flex-col gap-[var(--space-3)]">
          <span className="opacity-75">{t.freeSpaceBody}</span>

          <table className="w-full text-[var(--fs-sm)] border border-white/10 rounded">
            <thead>
              <tr className="opacity-60">
                <th className="text-left font-bold px-[var(--space-2)] py-[var(--space-1)]">{t.freeSpaceVolume}</th>
                <th className="text-right font-bold px-[var(--space-2)] py-[var(--space-1)]">{t.transferColSize}</th>
                <th className="text-right font-bold px-[var(--space-2)] py-[var(--space-1)]">{t.freeSpaceFree}</th>
                <th className="text-right font-bold px-[var(--space-2)] py-[var(--space-1)]">{t.freeSpaceLacking}</th>
              </tr>
            </thead>
            <tbody>
              {volumes.map((volume) => (
                <tr key={volume.volume} className="border-t border-white/10">
                  <td className="px-[var(--space-2)] py-[var(--space-1)] font-bold">{volume.volume}</td>
                  <td className="px-[var(--space-2)] py-[var(--space-1)] text-right tabular-nums">
                    {/* A pre-flight that stopped early only proves a lower bound;
                        promising an exact size there would be a lie. */}
                    {volume.complete === false ? '\u2265 ' : ''}
                    {formatBytes(volume.size)}
                  </td>
                  <td className="px-[var(--space-2)] py-[var(--space-1)] text-right tabular-nums">
                    {formatBytes(volume.free)}
                  </td>
                  <td
                    className={`px-[var(--space-2)] py-[var(--space-1)] text-right tabular-nums font-bold ${volume.lacking > 0 ? 'opacity-50' : ''}`}
                  >
                    <span style={{ color: volume.lacking > 0 ? theme.accentDanger : 'inherit' }}>
                      {volume.lacking > 0 ? formatBytes(volume.lacking) : '0 B'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-[var(--space-2)] px-[var(--space-4)] py-[var(--space-3)] border-t border-white/10">
          <button
            type="button"
            onClick={onCancel}
            className="mr-auto px-[var(--space-3)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
          >
            {t.btnCancel}
          </button>
          <button
            type="button"
            onClick={onForce}
            className="px-[var(--space-3)] py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
          >
            {t.freeSpaceForce}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FreeSpaceModal;
