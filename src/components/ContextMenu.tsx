import React, { useEffect, useRef } from 'react';
import {
  Eye,
  Edit3,
  Pencil,
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
  Star,
} from 'lucide-react';
import { FileItem, LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { SendToDestination } from '../services/fileSystem';
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
  onRename: () => void;
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
  /** Pins the target folder to the tree, or unpins it when it is already there. */
  onToggleFavorite?: () => void;
  /** Whether the target folder is already pinned, which decides the label. */
  isFavorite?: boolean;
  /** Sends the target to one of the user's folders (desktop: shortcut, rest: copy). */
  onSendTo?: (destination: SendToDestination) => void;
  /** Opens the folder picker, starting on the other panel. */
  onSendToFolder?: () => void;
  canSendTo?: boolean;
}

/**
 * One command in the menu.
 *
 * Out of the tab order on purpose: the menu owns focus and the arrows walk it,
 * so Tab does not have to cross fifteen commands before leaving. The container's
 * key handler is what moves focus between these.
 */
const MenuItem: React.FC<React.ComponentProps<'button'>> = (props) => (
  <button type="button" role="menuitem" tabIndex={-1} {...props} />
);

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
  onRename,
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
  onSendTo,
  onSendToFolder,
  onToggleFavorite,
  isFavorite = false,
  canSendTo = false,
}) => {
  const t = getTranslations(lang);
  const menuRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Focus enters on the first command and leaves where it came from: a menu that
  // closes back onto the body eats the next keystroke.
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();

    return () => {
      const target = restoreRef.current;
      if (target?.isConnected) target.focus();
    };
  }, []);

  /**
   * The keyboard a menu is expected to have: arrows move (wrapping), Home and End
   * go to the ends, Escape and Tab close. Everything handled here stops its own
   * propagation, because the global shortcut engine would otherwise move the
   * panel selection behind the open menu — the arrows and Tab are its keys too.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active) : -1;
    const focusAt = (next: number) => items[(next + items.length) % items.length].focus();

    const handled = (): boolean => {
      switch (event.key) {
        case 'ArrowDown':
          focusAt(index + 1);
          return true;
        case 'ArrowUp':
          focusAt(index < 0 ? items.length - 1 : index - 1);
          return true;
        case 'Home':
          items[0].focus();
          return true;
        case 'End':
          items[items.length - 1].focus();
          return true;
        case 'Escape':
        case 'Tab':
          onClose();
          return true;
        default:
          return false;
      }
    };

    if (!handled()) return;
    event.preventDefault();
    event.stopPropagation();
  };

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
      role="menu"
      aria-label={t.contextMenuLabel}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
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
          <div
            role="presentation"
            className="px-[var(--space-3)] py-[var(--space-1)] font-bold text-amber-400 border-b border-white/10 truncate"
          >
            {targetItem.name}
            {targetItem.ext ? `.${targetItem.ext}` : ''}
          </div>

          <MenuItem
            onClick={() => handleAction(onView)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <Eye className="w-3.5 h-3.5" /> {t.view}
            </span>
            <span className="opacity-60">F3</span>
          </MenuItem>

          {!targetItem.isDirectory && (
            <MenuItem
              onClick={() => handleAction(onEdit)}
              className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-center gap-[var(--space-2)]">
                <Edit3 className="w-3.5 h-3.5" /> {t.edit}
              </span>
              <span className="opacity-60">F4</span>
            </MenuItem>
          )}

          <MenuItem
            onClick={() => handleAction(onRename)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5" /> {t.rename}
          </MenuItem>

          <MenuItem
            onClick={() => handleAction(onCopy)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <Copy className="w-3.5 h-3.5" /> {t.copy}
            </span>
            <span className="opacity-60">F5</span>
          </MenuItem>

          <MenuItem
            onClick={() => handleAction(onMove)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <Scissors className="w-3.5 h-3.5" /> {t.move}
            </span>
            <span className="opacity-60">F6</span>
          </MenuItem>

          <MenuItem
            onClick={() => handleAction(onDelete)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-red-500/30 text-red-300 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <Trash2 className="w-3.5 h-3.5" /> {t.delete}
            </span>
            <span className="opacity-60">F8</span>
          </MenuItem>

          <div role="separator" className="h-px bg-current opacity-20 my-[var(--space-1)]" />

          {/* Archive Actions Section */}
          {(targetItem.ext?.toUpperCase() === 'ZIP' ||
            targetItem.ext?.toUpperCase() === 'RAR' ||
            targetItem.ext?.toUpperCase() === '7Z' ||
            targetItem.ext?.toUpperCase() === 'TAR') && (
            <>
              <div
                role="presentation"
                className="px-[var(--space-3)] py-[var(--space-1)] text-[10px] uppercase opacity-50 font-bold border-b border-white/10 mb-[var(--space-2)]"
              >
                {t.archiveActions || 'Archive Actions'}
              </div>

              <MenuItem
                onClick={() => handleAction(() => onArchiveInfo?.(targetItem))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
              >
                <span className="flex items-center gap-[var(--space-2)]">
                  <Info className="w-3.5 h-3.5 text-emerald-300" />
                  {t.archiveInfo || 'Archive Information'}
                </span>
              </MenuItem>

              <MenuItem
                onClick={() => handleAction(() => onArchiveInfo?.(targetItem))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
              >
                <span className="flex items-center gap-[var(--space-2)]">
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-300" />
                  {t.detectArchiveFormat || 'Detect Archive Format'}
                </span>
              </MenuItem>

              <div role="separator" className="h-px bg-current opacity-20 my-[var(--space-1)]" />
            </>
          )}

          {/* Creating here too: the panel the item lives in is where these land. */}
          <div role="separator" className="h-px bg-current opacity-20 my-[var(--space-1)]" />
          <MenuItem
            onClick={() => handleAction(onMkDir)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <FolderPlus className="w-3.5 h-3.5 text-amber-300" /> {t.newFolder}
            </span>
            <span className="opacity-60">F7</span>
          </MenuItem>

          <MenuItem
            onClick={() => handleAction(onNewFile)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
          >
            <FilePlus className="w-3.5 h-3.5 text-sky-300" /> {t.newFile}
          </MenuItem>

          {/* Only a real drive has a file on disk worth sending. */}
          {canSendTo && onSendTo && (
            <>
              <div role="separator" className="h-px bg-current opacity-20 my-[var(--space-1)]" />
              <div
                role="presentation"
                className="px-[var(--space-3)] py-[var(--space-1)] text-[10px] uppercase opacity-50 font-bold"
              >
                {t.sendTo}
              </div>
              <MenuItem
                onClick={() => handleAction(() => onSendTo('desktop'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
              >
                <span>🖥️ {t.sendToDesktop}</span>
              </MenuItem>
              <MenuItem
                onClick={() => handleAction(() => onSendTo('documents'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
              >
                <span>📄 {t.sendToDocuments}</span>
              </MenuItem>
              <MenuItem
                onClick={() => handleAction(() => onSendTo('downloads'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
              >
                <span>⬇️ {t.sendToDownloads}</span>
              </MenuItem>
              {onSendToFolder && (
                <MenuItem
                  onClick={() => handleAction(onSendToFolder)}
                  className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
                >
                  <span>📁 {t.sendToChooseFolder}</span>
                </MenuItem>
              )}
            </>
          )}

          <MenuItem
            onClick={() => handleAction(onZip)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
          >
            <FileArchive className="w-3.5 h-3.5 text-fuchsia-300" /> {t.zipPack}
          </MenuItem>

          <MenuItem
            onClick={() => handleAction(onChecksum)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
          >
            <Hash className="w-3.5 h-3.5 text-cyan-300" /> {t.calculateHash}
          </MenuItem>

          <MenuItem
            onClick={() => handleAction(onDownload)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-300" /> {t.btnDownload}
          </MenuItem>

          <div role="separator" className="h-px bg-current opacity-20 my-[var(--space-1)]" />

          <MenuItem
            onClick={() => handleAction(onProperties)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <Info className="w-3.5 h-3.5" /> {t.properties}
            </span>
            <span className="opacity-60">Alt+Enter</span>
          </MenuItem>

          {targetItem.isDirectory && onToggleFavorite && (
            <>
              <div role="separator" className="h-px bg-current opacity-20 my-[var(--space-1)]" />
              <MenuItem
                onClick={() => handleAction(onToggleFavorite)}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-yellow-500/20 text-yellow-200 flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-[var(--space-2)]">
                  <Star className={`w-3.5 h-3.5 text-yellow-300 ${isFavorite ? 'fill-current' : ''}`} />
                  {isFavorite ? t.removeFavorite : t.addFavorite}
                </span>
                <span className="opacity-60">★</span>
              </MenuItem>
            </>
          )}

          {targetItem.isDirectory && (
            <>
              <div role="separator" className="h-px bg-current opacity-20 my-[var(--space-1)]" />
              <MenuItem
                onClick={() => handleAction(onProtectFolder)}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-amber-500/20 text-amber-300 font-bold flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-[var(--space-2)]">
                  <Lock className="w-3.5 h-3.5 text-amber-400" /> {t.protectFolder}
                </span>
                <span className="opacity-60">🔒</span>
              </MenuItem>
            </>
          )}

          {!targetItem.isDirectory && onSplitFile && (
            <>
              <div role="separator" className="h-px bg-current opacity-20 my-[var(--space-1)]" />
              <MenuItem
                onClick={() => handleAction(onSplitFile)}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-cyan-500/20 text-cyan-300 font-bold flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-[var(--space-2)]">{t.splitJoinFile}</span>
                <span className="opacity-60">Split</span>
              </MenuItem>
            </>
          )}
        </>
      ) : (
        <>
          <MenuItem
            onClick={() => handleAction(onMkDir)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <FolderPlus className="w-3.5 h-3.5 text-amber-300" /> {t.newFolder}
            </span>
            <span className="opacity-60">F7</span>
          </MenuItem>

          <MenuItem
            onClick={() => handleAction(onNewFile)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
          >
            <FilePlus className="w-3.5 h-3.5 text-sky-300" /> {t.newFile}
          </MenuItem>

          <div role="separator" className="h-px bg-current opacity-20 my-[var(--space-1)]" />

          <MenuItem
            onClick={() => handleAction(onProtectFolder)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-amber-500/20 text-amber-300 font-bold flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <Lock className="w-3.5 h-3.5 text-amber-400" /> {t.protectThisFolder}
            </span>
            <span className="opacity-60">🔒</span>
          </MenuItem>

          <div role="separator" className="h-px bg-current opacity-20 my-[var(--space-1)]" />

          <MenuItem
            onClick={() => handleAction(onUpload)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center gap-[var(--space-2)] cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-300" /> {t.btnUpload}
          </MenuItem>

          <MenuItem
            onClick={() => handleAction(onRefresh)}
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <RefreshCw className="w-3.5 h-3.5" /> {t.refresh}
            </span>
            <span className="opacity-60">Ctrl+R</span>
          </MenuItem>
        </>
      )}
    </div>
  );
};
