import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Eye,
  Edit3,
  Pencil,
  Copy,
  Scissors,
  Trash2,
  FolderPlus,
  FolderOutput,
  FilePlus,
  FileArchive,
  Hash,
  Info,
  Download,
  Upload,
  RefreshCw,
  Lock,
  Star,
  Share2,
  ExternalLink,
} from 'lucide-react';
import { FileItem, LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { SendToDestination } from '../services/fileSystem';
import { getTranslations } from '../i18n/translations';
import { soundManager } from '../services/soundEffects';
import type { OpenWithProgram } from '../services/openWith';
import { appTargetsFor, type AppTarget } from '../services/appOpeners';

interface ContextMenuProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  x: number;
  y: number;
  targetItem: FileItem | null;
  onClose: () => void;
  onView: () => void;
  /** Hands the target to the Windows "Open with" chooser. */
  onOpenWith?: () => void;
  canOpenWith?: boolean;
  onEdit: () => void;
  onCopy: () => void;
  onMove: () => void;
  onDelete: () => void;
  onRename: () => void;
  onMkDir: () => void;
  onNewFile: () => void;
  onZip: () => void;
  /** True when the target is an archive some engine can read. */
  isArchive?: boolean;
  /** Extracts the target into the folder it lives in. */
  onExtractHere?: () => void;
  /** Extracts the target into a folder named after it, beside the archive. */
  onExtractIntoFolder?: () => void;
  /** Extracts the target into the pane that is not showing it. */
  onExtractToOtherPanel?: () => void;
  onChecksum: () => void;
  onProperties: () => void;
  onDownload: () => void;
  onUpload: () => void;
  onRefresh: () => void;
  onProtectFolder: () => void;
  /** Opens the network share dialog on the target folder, or on the panel's folder. */
  onShareFolder?: () => void;
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
  /** Programs Windows registered for the target's type, loaded when expanded. */
  loadOpenWithPrograms?: () => Promise<OpenWithProgram[]>;
  /** Opens the target with one of those programs. */
  onOpenWithProgram?: (program: OpenWithProgram) => void;
  /** Opens the target in one of the app's own tools. */
  onOpenInApp?: (target: AppTarget) => void;
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
  onOpenWith,
  onEdit,
  onCopy,
  onMove,
  onDelete,
  onRename,
  onMkDir,
  onNewFile,
  onZip,
  isArchive,
  onExtractHere,
  onExtractIntoFolder,
  onExtractToOtherPanel,
  onChecksum,
  onProperties,
  onDownload,
  onUpload,
  onRefresh,
  onProtectFolder,
  onShareFolder,
  onSplitFile,
  onArchiveInfo,
  onSendTo,
  onSendToFolder,
  onToggleFavorite,
  isFavorite = false,
  canSendTo = false,
  canOpenWith = false,
  loadOpenWithPrograms,
  onOpenWithProgram,
  onOpenInApp,
}) => {
  const t = getTranslations(lang);
  const menuRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // The submenu expands in place rather than opening a second floating panel: a
  // positioned popup inside a menu that already clamps itself to the window is
  // how a nested menu ends up half off-screen.
  const [openWithExpanded, setOpenWithExpanded] = useState(false);
  const [openWithPrograms, setOpenWithPrograms] = useState<OpenWithProgram[] | null>(null);
  const [openWithLoading, setOpenWithLoading] = useState(false);
  const [extractExpanded, setExtractExpanded] = useState(false);

  const toggleOpenWith = () => {
    soundManager.playKeyTick();
    // Expanding is not an action, so the menu stays open to pick a program.
    setOpenWithExpanded((expanded) => !expanded);
    if (openWithPrograms !== null || openWithLoading || !loadOpenWithPrograms) return;
    setOpenWithLoading(true);
    void loadOpenWithPrograms()
      .then((list) => setOpenWithPrograms(list))
      .catch(() => setOpenWithPrograms([]))
      .finally(() => setOpenWithLoading(false));
  };

  /** Expanding is not an action either: the menu stays open to pick a destination. */
  const toggleExtract = () => {
    soundManager.playKeyTick();
    setExtractExpanded((expanded) => !expanded);
  };

  // The fallback keeps the block for the formats it always offered when no caller
  // says otherwise; the menu itself now asks `isOpenable`, which also covers
  // TAR.GZ, TAR.BZ2 and TAR.LZMA instead of the four extensions it used to list.
  const archiveTarget =
    isArchive ?? ['ZIP', 'RAR', '7Z', 'TAR', 'TAR.GZ'].includes((targetItem?.ext ?? '').toUpperCase());

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
  // The menu grows with the item (archive block, send-to block, split), so its
  // height is measured rather than guessed: the old fixed 340 px allowance put
  // a right-click near the bottom edge half off the screen. A menu taller than
  // the window scrolls instead of being cut off.
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const margin = 8;
    const { offsetWidth: width, offsetHeight: height } = element;
    setPos({
      left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
    });
  }, [x, y, targetItem]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t.contextMenuLabel}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="fixed z-50 max-h-[calc(100vh-16px)] w-56 overflow-y-auto rounded border shadow-2xl py-[var(--space-1)] text-xs font-mono select-none"
      style={{
        left: `${pos.left}px`,
        top: `${pos.top}px`,
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

          {!targetItem.isDirectory && canOpenWith && onOpenWith && (
            <>
              <MenuItem
                aria-expanded={openWithExpanded}
                onClick={toggleOpenWith}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-[var(--space-2)]">
                  <ExternalLink className="w-3.5 h-3.5 text-violet-300" /> {t.openWith}
                </span>
                <span className="opacity-60">{openWithExpanded ? '▾' : '▸'}</span>
              </MenuItem>
              {openWithExpanded && (
                <div
                  role="group"
                  aria-label={t.openWith}
                  className="ml-[var(--space-3)] border-l border-white/10 pl-[var(--space-1)]"
                >
                  {/* The app's own tools come first: they need no Windows dialog
                      and no registration, and they are the reason to stay inside
                      OmniCommander. */}
                  {onOpenInApp &&
                    appTargetsFor(targetItem).map((target) => (
                      <MenuItem
                        key={target}
                        onClick={() => handleAction(() => onOpenInApp(target))}
                        className="w-full truncate text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 cursor-pointer"
                      >
                        {target === 'image'
                          ? t.toolImageStudio
                          : target === 'media'
                            ? t.openMediaPlayer
                            : target === 'text'
                              ? t.openTextEditor
                              : t.openTerminal}
                      </MenuItem>
                    ))}
                  {onOpenInApp && <div role="separator" className="h-px bg-current opacity-20 my-[var(--space-1)]" />}
                  {openWithLoading && (
                    <div role="presentation" className="px-[var(--space-3)] py-[var(--space-1)] opacity-60">
                      …
                    </div>
                  )}
                  {!openWithLoading && openWithPrograms?.length === 0 && (
                    <div role="presentation" className="px-[var(--space-3)] py-[var(--space-1)] opacity-60">
                      {t.openWithNoPrograms}
                    </div>
                  )}
                  {(openWithPrograms ?? []).map((program) => (
                    <MenuItem
                      key={program.id}
                      onClick={() => handleAction(() => onOpenWithProgram?.(program))}
                      className="w-full truncate text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 cursor-pointer"
                    >
                      {program.name}
                    </MenuItem>
                  ))}
                  <MenuItem
                    onClick={() => handleAction(onOpenWith)}
                    className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 cursor-pointer opacity-80"
                  >
                    {t.openWithOtherApp}
                  </MenuItem>
                </div>
              )}
            </>
          )}

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
            className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:nc-danger-surface-strong nc-danger-ink flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-[var(--space-2)]">
              <Trash2 className="w-3.5 h-3.5" /> {t.delete}
            </span>
            <span className="opacity-60">F8</span>
          </MenuItem>

          <div role="separator" className="h-px bg-current opacity-20 my-[var(--space-1)]" />

          {/* Archive Actions Section */}
          {archiveTarget && (
            <>
              <div
                role="presentation"
                className="px-[var(--space-3)] py-[var(--space-1)] text-[10px] uppercase opacity-50 font-bold border-b border-white/10 mb-[var(--space-2)]"
              >
                {t.archiveActions || 'Archive Actions'}
              </div>

              <MenuItem
                aria-expanded={extractExpanded}
                onClick={toggleExtract}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/20 flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-[var(--space-2)]">
                  <FolderOutput className="w-3.5 h-3.5 text-emerald-300" /> {t.extractMenu}
                </span>
                <span className="opacity-60">{extractExpanded ? '▾' : '▸'}</span>
              </MenuItem>
              {extractExpanded && (
                <div
                  role="group"
                  aria-label={t.extractMenu}
                  className="ml-[var(--space-3)] border-l border-white/10 pl-[var(--space-1)]"
                >
                  <MenuItem
                    onClick={() => handleAction(() => onExtractHere?.())}
                    className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 cursor-pointer"
                  >
                    {t.extractHere}
                  </MenuItem>
                  <MenuItem
                    onClick={() => handleAction(() => onExtractIntoFolder?.())}
                    className="w-full truncate text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 cursor-pointer"
                  >
                    {t.extractIntoFolder.replace('{name}', targetItem.name)}
                  </MenuItem>
                  <MenuItem
                    onClick={() => handleAction(() => onExtractToOtherPanel?.())}
                    className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 cursor-pointer"
                  >
                    {t.extractToOtherPanel}
                  </MenuItem>
                </div>
              )}

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
            <FileArchive className="w-3.5 h-3.5" style={{ color: theme.zipText }} /> {t.zipPack}
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

          {targetItem.isDirectory && onShareFolder && (
            <MenuItem
              onClick={() => handleAction(onShareFolder)}
              className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-emerald-500/20 text-emerald-300 flex items-center gap-[var(--space-2)] cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5 text-emerald-300" /> {t.shareNetwork}
            </MenuItem>
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

          {onShareFolder && (
            <MenuItem
              onClick={() => handleAction(onShareFolder)}
              className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-emerald-500/20 text-emerald-300 flex items-center gap-[var(--space-2)] cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5 text-emerald-300" /> {t.shareNetwork}
            </MenuItem>
          )}

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
