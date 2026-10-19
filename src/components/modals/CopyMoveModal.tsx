import React, { useState } from 'react';
import { Copy, Scissors } from 'lucide-react';
import { CollisionPolicy, FileItem, LanguageCode, TransferOptions } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';

interface CopyMoveModalProps {
  type: 'copy' | 'move';
  theme: ThemeConfig;
  lang: LanguageCode;
  items: FileItem[];
  sourcePath: string;
  targetPath: string;
  targetDriveId: string;
  onConfirm: (targetPath: string, options: TransferOptions) => void;
  onClose: () => void;
}

const COLLISION_OPTIONS: Array<[CollisionPolicy, 'collisionOverwrite' | 'collisionSkip' | 'collisionRename']> = [
  ['overwrite', 'collisionOverwrite'],
  ['skip', 'collisionSkip'],
  ['rename', 'collisionRename']
];

const SPEED_OPTIONS_MB = [1, 5, 10, 50];

export const CopyMoveModal: React.FC<CopyMoveModalProps> = ({
  type,
  theme,
  lang,
  items,
  targetPath,
  onConfirm,
  onClose
}) => {
  const t = getTranslations(lang);
  const [destPath, setDestPath] = useState(targetPath);
  const [collision, setCollision] = useState<CollisionPolicy>('overwrite');
  // 0 means "no cap"; anything else is a cap in MB/s, converted to bytes on submit.
  const [speedLimitMb, setSpeedLimitMb] = useState(0);

  const isCopy = type === 'copy';
  const totalSize = items.reduce((acc, i) => acc + (i.isDirectory ? 0 : i.size), 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!destPath.trim()) return;
    soundManager.playDiskAccess();
    onConfirm(destPath.trim(), {
      collision,
      throttleBps: speedLimitMb > 0 ? Math.round(speedLimitMb * 1024 * 1024) : 0
    });
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.copyMoveModalTitle);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="flex flex-col rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText,
          // User-resizable: drag any edge or the bottom-right corner. The dialog
          // starts at 32rem wide, can grow up to the overlay (never past the
          // viewport) and cannot collapse below a usable minimum.
          resize: 'both',
          width: '32rem',
          minWidth: '18rem',
          minHeight: '12rem',
          maxWidth: '100%',
          maxHeight: '100%'
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between px-3 py-2 border-b font-bold shrink-0"
          style={{
            backgroundColor: theme.modalHeaderBg,
            color: theme.modalHeaderText,
            borderColor: theme.modalBorder
          }}
        >
          <div className="flex items-center gap-2">
            {isCopy ? <Copy className="w-4 h-4" /> : <Scissors className="w-4 h-4" />}
            <span>{isCopy ? t.copyTitle : t.moveTitle} ({isCopy ? 'F5' : 'F6'})</span>
          </div>
          <button onClick={onClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer">✕</button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-4 min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col min-h-0 flex-1">
            <span className="opacity-75 block mb-1">
              {isCopy
                ? t.copyItemsLead.replace('{n}', String(items.length)).replace('{size}', totalSize.toLocaleString())
                : t.moveItemsLead.replace('{n}', String(items.length)).replace('{size}', totalSize.toLocaleString())}
            </span>
            <div className="flex-1 min-h-16 overflow-y-auto bg-black/40 p-2 rounded border border-white/10 text-[11px]">
              {items.map(i => (
                <div key={i.id} className="truncate text-amber-300">
                  • {i.name}{i.ext ? `.${i.ext}` : ''} {i.isDirectory ? '<DIR>' : ''}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-bold text-white mb-1">{t.copyMoveDestLabel}</label>
            <input
              type="text"
              value={destPath}
              onChange={(e) => setDestPath(e.target.value)}
              className="w-full bg-black/50 border border-white/30 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none"
              autoFocus
            />
          </div>

          {/* What to do when the destination entry already exists. */}
          <div>
            <span className="block font-bold text-white mb-1">{t.collisionPolicy}</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1" role="radiogroup" aria-label={t.collisionPolicy}>
              {COLLISION_OPTIONS.map(([value, labelKey]) => (
                <label key={value} className="flex items-center gap-1.5 cursor-pointer opacity-90">
                  <input
                    type="radio"
                    name="collisionPolicy"
                    value={value}
                    checked={collision === value}
                    onChange={() => setCollision(value)}
                    className="cursor-pointer"
                  />
                  <span>{t[labelKey]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Optional bandwidth cap, SuperCopier style. */}
          <div>
            <label className="block font-bold text-white mb-1" htmlFor="speedLimitSelect">{t.speedLimit}</label>
            <select
              id="speedLimitSelect"
              value={speedLimitMb}
              onChange={(e) => setSpeedLimitMb(Number(e.target.value))}
              className="w-full bg-black/50 border border-white/30 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none cursor-pointer"
            >
              <option value={0}>{t.speedUnlimited}</option>
              {SPEED_OPTIONS_MB.map(mb => (
                <option key={mb} value={mb}>{mb} MB/s</option>
              ))}
            </select>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
            >
              {t.btnCancel} (Esc)
            </button>
            <button
              type="submit"
              className="px-5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
            >
              {isCopy ? t.copyConfirm : t.moveConfirm}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
