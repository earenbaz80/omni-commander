import React, { useEffect, useRef } from 'react';
import {
  Eye,
  Edit3,
  Copy,
  Scissors,
  Trash2,
  FolderPlus,
  FilePlus,
  FileArchive,
  Hash,
  Info,
  Download,
  Upload,
  RefreshCw,
  Lock,
} from 'lucide-react';
import { FileItem, LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { getTranslations } from '../i18n/translations';
import { soundManager } from '../services/soundEffects';

interface ContextMenuProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  x: number;
  y: number;
  targetItem: FileItem | null;
  onClose: () => void;
  onView: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onMove: () => void;
  onDelete: () => void;
  onMkDir: () => void;
  onNewFile: () => void;
  onZip: () => void;
  onChecksum: () => void;
  onProperties: () => void;
  onDownload: () => void;
  onUpload: () => void;
  onRefresh: () => void;
  onProtectFolder: () => void;
  onSplitFile?: () => void;
  onArchiveInfo?: (item: FileItem) => void;
  onSendToDesktop?: () => void;
  onSendToDocuments?: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  theme,
  lang,
  x,
  y,
  targetItem,
  onClose,
  onView,
  onEdit,
  onCopy,
  onMove,
  onDelete,
  onMkDir,
  onNewFile,
  onZip,
  onChecksum,
  onProperties,
  onDownload,
  onUpload,
  onRefresh,
  onProtectFolder,
  onSplitFile,
  onArchiveInfo,
  onSendToDesktop,
  onSendToDocuments,
}) => {
  const t = getTranslations(lang);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const handleAction = (action: () => void) => {
    soundManager.playKeyTick();
    action();
    onClose();
  };

  // Adjust coordinates so menu doesn't go offscreen
  const adjustedX = Math.min(x, window.innerWidth - 220);
  const adjustedY = Math.min(y, window.innerHeight - 340);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-56 rounded border shadow-2xl py-[var(--space-1)] text-xs font-mono select-none"
      style={{
        left: `${adjustedX}px`,
        top: `${adjustedY}px`,
        backgroundColor: theme.modalBg,
        borderColor: theme.borderPanel,
        color: theme.itemText,
      }}
    >
      {targetItem ? (
        <>
          <div className="px-[var(--space-3)] py-[var(--space-1)] font-bold text-amber-400 border-b border-white/10 truncate">
            {targetItem.name}
            {targetItem.ext ? `.${targetItem.ext}` : ''}
          </div>

          <button
            onClick={() => handleAction(onView)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <Eye className="w-3.5 h-3.5" /> {t.view}
            </span>
            <span className="opacity-60">F3</span>
          </button>

          {!targetItem.isDirectory && (
            <button
              onClick={() => handleAction(onEdit)}
              className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-center gap-[var(--space-2)]">
                <Edit3 className="w-3.5 h-3.5" /> {t.edit}
              </span>
              <span className="opacity-60">F4</span>
            </button>
          )}

          <button
            onClick={() => handleAction(onCopy)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <Copy className="w-3.5 h-3.5" /> {t.copy}
            </span>
            <span className="opacity-60">F5</span>
          </button>

          <button
            onClick={() => handleAction(onMove)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <Scissors className="w-3.5 h-3.5" /> {t.move}
            </span>
            <span className="opacity-60">F6</span>
          </button>

          <button
            onClick={() => handleAction(onDelete)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-red-500/30 text-red-300 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <Trash2 className="w-3.5 h-3.5" /> {t.delete}
            </span>
            <span className="opacity-60">F8</span>
          </button>

          <div className="h-px bg-current opacity-20 my-[var(--space-1)]" />

          {/* Archive Actions Section */}
          {(targetItem.ext?.toUpperCase() === 'ZIP' ||
            targetItem.ext?.toUpperCase() === 'RAR' ||
            targetItem.ext?.toUpperCase() === '7Z' ||
            targetItem.ext?.toUpperCase() === 'TAR') && (
            <>
              <div className="px-[var(--space-3)] py-[var(--space-1)] text-[10px] uppercase opacity-50 font-bold border-b border-white/10 mb-[var(--space-2)]">
                {t.archiveActions || 'Archive Actions'}
              </div>

              <button
                onClick={() => handleAction(() => onArchiveInfo?.(targetItem))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
              >
                <span className="flex items-center gap-[var(--space-2)]">
                  <Info className="w-3.5 h-3.5 text-emerald-300" />
                  {t.archiveInfo || 'Archive Information'}
                </span>
              </button>

              <button
                onClick={() => handleAction(() => onArchiveInfo?.(targetItem))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
              >
                <span className="flex items-center gap-[var(--space-2)]">
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-300" />
                  {t.detectArchiveFormat || 'Detect Archive Format'}
                </span>
              </button>

              <div className="h-px bg-current opacity-20 my-[var(--space-1)]" />
            </>
          )}

          <div className="h-px bg-current opacity-20 my-[var(--space-1)]" />
          <div className="px-[var(--space-3)] py-[var(--space-1)] text-[10px] uppercase opacity-50 font-bold">
            Enviar a:
          </div>
          <button onClick={() => handleAction(onSendToDesktop)} className="...cursor-pointer">
            <span>🖥️ Escritorio</span>
          </button>
          <button onClick={() => handleAction(onSendToDocuments)} className="...cursor-pointer">
            <span>📄 Documentos</span>
          </button>

          <button
            onClick={() => handleAction(onZip)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
          >
            <FileArchive className="w-3.5 h-3.5 text-fuchsia-300" /> {t.zipPack}
          </button>

          <button
            onClick={() => handleAction(onChecksum)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
          >
            <Hash className="w-3.5 h-3.5 text-cyan-300" /> {t.calculateHash}
          </button>

          <button
            onClick={() => handleAction(onDownload)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-300" /> {t.btnDownload}
          </button>

          <div className="h-px bg-current opacity-20 my-[var(--space-1)]" />

          <button
            onClick={() => handleAction(onProperties)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <Info className="w-3.5 h-3.5" /> {t.properties}
            </span>
            <span className="opacity-60">Alt+Enter</span>
          </button>

          {targetItem.isDirectory && (
            <>
              <div className="h-px bg-current opacity-20 my-[var(--space-1)]" />
              <button
                onClick={() => handleAction(onProtectFolder)}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-amber-500/20 text-amber-300 font-bold flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-[var(--space-2)]">
                  <Lock className="w-3.5 h-3.5 text-amber-400" /> {t.protectFolder}
                </span>
                <span className="opacity-60">🔒</span>
              </button>
            </>
          )}

          {!targetItem.isDirectory && onSplitFile && (
            <>
              <div className="h-px bg-current opacity-20 my-[var(--space-1)]" />
              <button
                onClick={() => handleAction(onSplitFile)}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-cyan-500/20 text-cyan-300 font-bold flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-[var(--space-2)]">{t.splitJoinFile}</span>
                <span className="opacity-60">Split</span>
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <button
            onClick={() => handleAction(onMkDir)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <FolderPlus className="w-3.5 h-3.5 text-amber-300" /> {t.newFolder}
            </span>
            <span className="opacity-60">F7</span>
          </button>

          <button
            onClick={() => handleAction(onNewFile)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
          >
            <FilePlus className="w-3.5 h-3.5 text-sky-300" /> {t.newFile}
          </button>

          <div className="h-px bg-current opacity-20 my-[var(--space-1)]" />

          <button
            onClick={() => handleAction(onProtectFolder)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-amber-500/20 text-amber-300 font-bold flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <Lock className="w-3.5 h-3.5 text-amber-400" /> {t.protectThisFolder}
            </span>
            <span className="opacity-60">🔒</span>
          </button>

          <div className="h-px bg-current opacity-20 my-[var(--space-1)]" />

          <button
            onClick={() => handleAction(onUpload)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-300" /> {t.btnUpload}
          </button>

          <button
            onClick={() => handleAction(onRefresh)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <RefreshCw className="w-3.5 h-3.5" /> {t.refresh}
            </span>
            <span className="opacity-60">Ctrl+R</span>
          </button>
        </>
      )}
    </div>
  );
};
