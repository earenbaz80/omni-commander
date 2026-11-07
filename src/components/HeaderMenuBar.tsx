import React, { useState, useRef, useEffect } from 'react';
import { Settings, Terminal, Minimize2, Maximize2, Minus, Square, X, Clock } from 'lucide-react';
import { ActiveModal, LanguageCode, ThemeId } from '../types';
import { getTranslations } from '../i18n/translations';
import { ThemeConfig } from '../services/themeManager';
import { soundManager } from '../services/soundEffects';
import { PWAInstallButton } from './PWAInstallButton';
import { UpdateBadge } from './UpdateBadge';

/**
 * How long a hover-opened menu survives the pointer leaving the bar.
 *
 * The few pixels between a title and its panel belong to neither the title nor
 * the panel, so walking down to the menu leaves the bar on the way. Closing at
 * once made the menu unreachable with the mouse; this delay is long enough to
 * cross that gap and short enough to feel immediate when the pointer really
 * leaves.
 */
const MENU_CLOSE_DELAY_MS = 200;

interface HeaderMenuBarProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  showClock?: boolean;
  clockPosition?: 'header' | 'footer' | 'both';
  /** Menus open as the pointer crosses their title, without a click (Settings > Appearance). */
  hoverOpen?: boolean;
  crtEffectEnabled?: boolean;
  onToggleCrt?: () => void;
  onOpenModal: (modal: ActiveModal) => void;
  onRefresh: () => void;
  onSelectAll: () => void;
  onInvertSelection: () => void;
  onToggleQuickView: () => void;
  onToggleTree: () => void;
  onSwapPanels?: () => void;
  onNewTab: (panel: 'left' | 'right') => void;
  onChangeDrive: (panel: 'left' | 'right', driveId: string) => void;
  activePanel: 'left' | 'right';
  isQuickView: boolean;
  isTreeVisible: boolean;
  onSetTheme: (themeId: ThemeId) => void;
  onSetLang: (lang: LanguageCode) => void;
  onResetDefaults: () => void;
  // Controls for frameless Electron/Tauri windows (optional in browser)
  onMinimizeWindow?: () => void;
  onMaximizeWindow?: () => void;
  onCloseWindow?: () => void;
}

export const HeaderMenuBar: React.FC<HeaderMenuBarProps> = ({
  theme,
  lang,
  showClock = true,
  clockPosition = 'header',
  hoverOpen = false,
  onOpenModal,
  onRefresh,
  onSelectAll,
  onInvertSelection,
  onToggleQuickView,
  onToggleTree,
  onSwapPanels,
  onNewTab,
  isTreeVisible,
  onSetTheme,
  onResetDefaults,
  onMinimizeWindow,
  onMaximizeWindow,
  onCloseWindow,
}) => {
  const t = getTranslations(lang);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [timeStr, setTimeStr] = useState(() => new Date().toLocaleTimeString());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  /** Pending close of a hover-opened menu, cancelled when the pointer comes back. */
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeStr(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleFullscreen = () => {
    soundManager.playKeyTick();
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMenuClick = (menuName: string) => {
    soundManager.playKeyTick();
    cancelScheduledClose();
    setOpenMenu(openMenu === menuName ? null : menuName);
  };

  /**
   * Crossing a title opens its menu when the setting asks for it, and moving on
   * to the next title switches menus instead of stacking them. It stays silent:
   * a tick per title would turn browsing the bar into noise.
   */
  const hoverMenu = (menuName: string) => {
    if (!hoverOpen || openMenu === menuName) return;
    setOpenMenu(menuName);
  };

  const handleAction = (action: () => void) => {
    soundManager.playKeyTick();
    cancelScheduledClose();
    setOpenMenu(null);
    action();
  };

  const cancelScheduledClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  /** Closes a hover-opened menu once the pointer has had time to reach the panel. */
  const scheduleClose = () => {
    if (!hoverOpen) return;
    cancelScheduledClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpenMenu(null);
    }, MENU_CLOSE_DELAY_MS);
  };

  /** A pointer that comes back onto the bar, or onto another title, keeps the menu. */
  const enterMenu = (menuName: string) => {
    cancelScheduledClose();
    hoverMenu(menuName);
  };

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  // Leaving the whole bar closes what hovering opened, once the pointer has had
  // time to cross the gap onto the panel. A menu opened by a click is left
  // alone: that is the behaviour this bar had before the setting existed.
  return (
    <div
      ref={menuRef}
      onMouseEnter={cancelScheduledClose}
      onMouseLeave={scheduleClose}
      className="nc-drag flex items-center justify-between px-[var(--space-2)] py-[var(--space-1)] text-xs select-none border-b shrink-0 z-30 font-mono tracking-wide"
      style={{
        backgroundColor: theme.headerBg,
        color: theme.headerText,
        borderColor: theme.borderPanel,
      }}
    >
      {/* Left zone: Frameless window controls + Brand & Menus */}
      <div className="flex items-center gap-[var(--space-1)]">
        {(onMinimizeWindow || onMaximizeWindow || onCloseWindow) && (
          <div className="flex items-center gap-0.5 mr-2 pr-2 border-r border-white/20 shrink-0">
            <button
              onClick={onMinimizeWindow}
              className="p-0.5 hover:bg-black/30 rounded transition-colors cursor-pointer"
              title={t.minimize}
            >
              <Minus className="w-3 h-3" />
            </button>
            <button
              onClick={onMaximizeWindow}
              className="p-0.5 hover:bg-black/30 rounded transition-colors cursor-pointer"
              title={t.maximizeRestore}
            >
              <Square className="w-3 h-3" />
            </button>
            <button
              onClick={onCloseWindow}
              className="p-0.5 hover:bg-red-500/80 rounded transition-colors cursor-pointer"
              title={t.btnClose}
            >
              <X className="w-3 h-3 text-red-500" />
            </button>
          </div>
        )}

        {/* The brand stays on one line: when the header runs out of room the box
            shrinks and the name scrolls sideways instead of wrapping. */}
        <div className="nc-scroll-x flex items-center gap-[var(--space-1)] font-bold px-[var(--space-2)] py-[var(--space-1)] mr-2 rounded bg-black/20 min-w-0 overflow-x-auto">
          <span className="font-semibold whitespace-nowrap">{t.appName}</span>
        </div>

        {/* Menu items */}
        <div className="relative inline-block" onMouseEnter={() => enterMenu('left')}>
          <button
            onClick={() => handleMenuClick('left')}
            className={`px-[var(--space-2)] py-[var(--space-1)] hover:bg-black/20 transition-colors uppercase font-medium ${openMenu === 'left' ? 'bg-black/30 font-bold' : ''}`}
          >
            <u>{t.menuLeft.charAt(0)}</u>
            {t.menuLeft.slice(1)}
          </button>
          {openMenu === 'left' && (
            <div
              className="absolute left-0 mt-0.5 w-56 shadow-2xl border py-1 z-50 text-xs font-mono"
              style={{ backgroundColor: theme.modalBg, color: theme.itemText, borderColor: theme.borderPanel }}
            >
              <button
                onClick={() => handleAction(() => onNewTab('left'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.newTab}</span> <span className="opacity-60">Ctrl+T</span>
              </button>
              <button
                onClick={() => handleAction(onToggleTree)}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.toggleTree}</span> <span className="opacity-60">{isTreeVisible ? '✓' : ''}</span>
              </button>
              <button
                onClick={() => handleAction(onToggleQuickView)}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.quickView}</span> <span className="opacity-60">Ctrl+Q</span>
              </button>
              <div className="h-px bg-current opacity-20 my-1"></div>
              <button
                onClick={() => handleAction(onRefresh)}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.refresh}</span> <span className="opacity-60">Ctrl+R</span>
              </button>
            </div>
          )}
        </div>

        {/* Files menu */}
        <div className="relative inline-block" onMouseEnter={() => enterMenu('files')}>
          <button
            onClick={() => handleMenuClick('files')}
            className={`px-[var(--space-2)] py-[var(--space-1)] hover:bg-black/20 transition-colors uppercase font-medium ${openMenu === 'files' ? 'bg-black/30 font-bold' : ''}`}
          >
            <u>{t.menuFiles.charAt(0)}</u>
            {t.menuFiles.slice(1)}
          </button>
          {openMenu === 'files' && (
            <div
              className="absolute left-0 mt-0.5 w-60 shadow-2xl border py-1 z-50 text-xs font-mono"
              style={{ backgroundColor: theme.modalBg, color: theme.itemText, borderColor: theme.borderPanel }}
            >
              <button
                onClick={() => handleAction(() => onOpenModal('viewer'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.view}</span> <span className="opacity-60">F3</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('editor'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.edit}</span> <span className="opacity-60">F4</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('copy'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.copy}</span> <span className="opacity-60">F5</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('move'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.move}</span> <span className="opacity-60">F6</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('mkdir'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.mkdir}</span> <span className="opacity-60">F7</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('delete'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.delete}</span> <span className="opacity-60">F8 / Del</span>
              </button>
              <div className="h-px bg-current opacity-20 my-1"></div>
              <button
                onClick={() => handleAction(() => onOpenModal('batch_rename'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.batchRename}</span> <span className="opacity-60">Ctrl+M</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('zipArchive'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.zipPack}</span> <span className="opacity-60">Alt+F5</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('checksum'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.calculateHash}</span> <span className="opacity-60">Ctrl+H</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('properties'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.properties}</span> <span className="opacity-60">Alt+Enter</span>
              </button>
            </div>
          )}
        </div>

        {/* Commands menu */}
        <div className="relative inline-block" onMouseEnter={() => enterMenu('commands')}>
          <button
            onClick={() => handleMenuClick('commands')}
            className={`px-[var(--space-2)] py-[var(--space-1)] hover:bg-black/20 transition-colors uppercase font-medium ${openMenu === 'commands' ? 'bg-black/30 font-bold' : ''}`}
          >
            <u>{t.menuCommands.charAt(0)}</u>
            {t.menuCommands.slice(1)}
          </button>
          {openMenu === 'commands' && (
            <div
              className="absolute left-0 mt-0.5 w-60 shadow-2xl border py-1 z-50 text-xs font-mono"
              style={{ backgroundColor: theme.modalBg, color: theme.itemText, borderColor: theme.borderPanel }}
            >
              <button
                onClick={() => handleAction(() => onOpenModal('hotlist_bookmarks'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between text-amber-300 font-bold"
              >
                <span>{t.bookmarks}</span> <span className="opacity-60">Ctrl+D</span>
              </button>
              {onSwapPanels && (
                <button
                  onClick={() => handleAction(onSwapPanels)}
                  className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
                >
                  <span>{t.headerSwapPanels}</span> <span className="opacity-60">Ctrl+U</span>
                </button>
              )}
              <button
                onClick={() => handleAction(() => onOpenModal('recycle_bin'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between text-rose-300"
              >
                <span>{t.recycleBin}</span> <span className="opacity-60">TR:</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('background_tasks'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between text-cyan-300 font-bold"
              >
                <span>{t.taskQueue}</span> <span className="opacity-60">Queue</span>
              </button>
              <div className="h-px bg-current opacity-20 my-1"></div>
              <button
                onClick={() => handleAction(() => onOpenModal('search_grep'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.searchGrep}</span> <span className="opacity-60">Alt+F7</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('diff_compare'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.compareFiles}</span> <span className="opacity-60">Diff</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('sync_folders'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between text-amber-300 font-bold"
              >
                <span>{t.syncFolders}</span> <span className="opacity-60">Sync</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('file_splitter'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between text-cyan-300 font-bold"
              >
                <span>{t.splitJoinFileMenu}</span> <span className="opacity-60">Split</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('disk_usage'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.diskUsage}</span> <span className="opacity-60">Ctrl+L</span>
              </button>
              <div className="h-px bg-current opacity-20 my-1"></div>
              <button
                onClick={() => handleAction(onSelectAll)}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.selectAll}</span> <span className="opacity-60">Ctrl+A / +</span>
              </button>
              <button
                onClick={() => handleAction(onInvertSelection)}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.invertSelection}</span> <span className="opacity-60">*</span>
              </button>
              <div className="h-px bg-current opacity-20 my-1"></div>
              <button
                onClick={() => handleAction(() => onOpenModal('user_menu'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.userMenu}</span> <span className="opacity-60">F2</span>
              </button>
            </div>
          )}
        </div>

        {/* Apps menu: the tools that live inside OmniCommander */}
        <div className="relative inline-block" onMouseEnter={() => enterMenu('apps')}>
          <button
            onClick={() => handleMenuClick('apps')}
            className={`px-[var(--space-2)] py-[var(--space-1)] hover:bg-black/20 transition-colors uppercase font-medium ${openMenu === 'apps' ? 'bg-black/30 font-bold' : ''}`}
          >
            <u>{t.menuApps.charAt(0)}</u>
            {t.menuApps.slice(1)}
          </button>
          {openMenu === 'apps' && (
            <div
              className="absolute left-0 mt-0.5 w-60 shadow-2xl border py-1 z-50 text-xs font-mono"
              style={{ backgroundColor: theme.modalBg, color: theme.itemText, borderColor: theme.borderPanel }}
            >
              <button
                onClick={() => handleAction(() => onOpenModal('calculator'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.toolCalculator}</span> <span className="opacity-60">1</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('calendar'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.toolCalendar}</span> <span className="opacity-60">2</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('image_studio'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.toolImageStudio}</span> <span className="opacity-60">3</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('maps'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between text-emerald-300 font-bold"
              >
                <span>{t.toolMaps}</span> <span className="opacity-60">4</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('terminal'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between text-emerald-300 font-bold"
              >
                <span>{t.toolTerminal}</span> <span className="opacity-60">Ctrl+`</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('editor'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.openTextEditor}</span> <span className="opacity-60">F4</span>
              </button>
            </div>
          )}
        </div>

        {/* Options menu */}
        <div className="relative inline-block" onMouseEnter={() => enterMenu('options')}>
          <button
            onClick={() => handleMenuClick('options')}
            className={`px-[var(--space-2)] py-[var(--space-1)] hover:bg-black/20 transition-colors uppercase font-medium ${openMenu === 'options' ? 'bg-black/30 font-bold' : ''}`}
          >
            <u>{t.menuOptions.charAt(0)}</u>
            {t.menuOptions.slice(1)}
          </button>
          {openMenu === 'options' && (
            <div
              className="absolute left-0 mt-0.5 w-64 shadow-2xl border py-1 z-50 text-xs font-mono"
              style={{ backgroundColor: theme.modalBg, color: theme.itemText, borderColor: theme.borderPanel }}
            >
              <button
                onClick={() => handleAction(() => onOpenModal('settings'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.settings}</span> <span className="opacity-60">Alt+O</span>
              </button>
              <div className="h-px bg-current opacity-20 my-1"></div>
              <div className="px-[var(--space-3)] py-[var(--space-1)] font-bold text-xs uppercase opacity-75">
                {t.visualTheme}
              </div>
              <button
                onClick={() => handleAction(() => onSetTheme('classic_blue'))}
                className="w-full text-left px-4 py-0.5 hover:bg-white/20"
              >
                {t.themeOmniClassic} {theme.id === 'classic_blue' ? '✓' : ''}
              </button>
              <button
                onClick={() => handleAction(() => onSetTheme('midnight_amber'))}
                className="w-full text-left px-4 py-0.5 hover:bg-white/20"
              >
                Midnight Amber DOS {theme.id === 'midnight_amber' ? '✓' : ''}
              </button>
              <button
                onClick={() => handleAction(() => onSetTheme('matrix_green'))}
                className="w-full text-left px-4 py-0.5 hover:bg-white/20"
              >
                Matrix Terminal {theme.id === 'matrix_green' ? '✓' : ''}
              </button>
              <button
                onClick={() => handleAction(() => onSetTheme('windows11_dark'))}
                className="w-full text-left px-4 py-0.5 hover:bg-white/20"
              >
                Windows 11 Dark {theme.id === 'windows11_dark' ? '✓' : ''}
              </button>
              <button
                onClick={() => handleAction(() => onSetTheme('retro_gray'))}
                className="w-full text-left px-4 py-0.5 hover:bg-white/20"
              >
                {t.themeOmniRetro} {theme.id === 'retro_gray' ? '✓' : ''}
              </button>
              <div className="h-px bg-current opacity-20 my-1"></div>
              <button
                onClick={() => handleAction(onResetDefaults)}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] text-red-400 hover:bg-red-500/20"
              >
                {t.menuResetFactory}
              </button>
            </div>
          )}
        </div>

        {/* FTP menu */}
        <div className="relative inline-block" onMouseEnter={() => enterMenu('ftp')}>
          <button
            onClick={() => handleMenuClick('ftp')}
            className={`px-[var(--space-2)] py-[var(--space-1)] hover:bg-black/20 transition-colors uppercase font-medium ${openMenu === 'ftp' ? 'bg-black/30 font-bold' : ''}`}
          >
            <u>F</u>TP
          </button>
          {openMenu === 'ftp' && (
            <div
              className="absolute left-0 mt-0.5 w-60 shadow-2xl border py-1 z-50 text-xs font-mono"
              style={{ backgroundColor: theme.modalBg, color: theme.itemText, borderColor: theme.borderPanel }}
            >
              <button
                onClick={() => handleAction(() => onOpenModal('ftp_manager'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 text-emerald-300 font-bold flex justify-between"
              >
                <span>{t.connectFtp}</span> <span className="opacity-60">🌐</span>
              </button>
            </div>
          )}
        </div>

        {/* Right menu */}
        <div className="relative inline-block" onMouseEnter={() => enterMenu('right')}>
          <button
            onClick={() => handleMenuClick('right')}
            className={`px-[var(--space-2)] py-[var(--space-1)] hover:bg-black/20 transition-colors uppercase font-medium ${openMenu === 'right' ? 'bg-black/30 font-bold' : ''}`}
          >
            <u>{t.menuRight.charAt(0)}</u>
            {t.menuRight.slice(1)}
          </button>
          {openMenu === 'right' && (
            <div
              className="absolute left-0 mt-0.5 w-56 shadow-2xl border py-1 z-50 text-xs font-mono"
              style={{ backgroundColor: theme.modalBg, color: theme.itemText, borderColor: theme.borderPanel }}
            >
              <button
                onClick={() => handleAction(() => onNewTab('right'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.newTab}</span> <span className="opacity-60">Ctrl+T</span>
              </button>
              <button
                onClick={() => handleAction(onToggleTree)}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.toggleTree}</span> <span className="opacity-60">{isTreeVisible ? '✓' : ''}</span>
              </button>
              <button
                onClick={() => handleAction(onToggleQuickView)}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.quickView}</span> <span className="opacity-60">Ctrl+Q</span>
              </button>
            </div>
          )}
        </div>

        {/* Help menu */}
        <div className="relative inline-block" onMouseEnter={() => enterMenu('help')}>
          <button
            onClick={() => handleMenuClick('help')}
            className={`px-[var(--space-2)] py-[var(--space-1)] hover:bg-black/20 transition-colors uppercase font-medium ${openMenu === 'help' ? 'bg-black/30 font-bold' : ''}`}
          >
            <u>{t.menuHelp.charAt(0)}</u>
            {t.menuHelp.slice(1)}
          </button>
          {openMenu === 'help' && (
            <div
              className="absolute left-0 mt-0.5 w-60 shadow-2xl border py-1 z-50 text-xs font-mono"
              style={{ backgroundColor: theme.modalBg, color: theme.itemText, borderColor: theme.borderPanel }}
            >
              <button
                onClick={() => handleAction(() => onOpenModal('help'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between font-bold text-amber-300"
              >
                <span>{t.helpTitle}</span> <span className="opacity-60">F1</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('protect_folder'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.protectFolder}</span> <span className="opacity-60">🔒</span>
              </button>
              <button
                onClick={() => handleAction(() => onOpenModal('app_lock'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 flex justify-between"
              >
                <span>{t.lockApp}</span> <span className="opacity-60">🛡️</span>
              </button>
              <div className="h-px bg-current opacity-20 my-1"></div>
              <button
                onClick={() => handleAction(() => onOpenModal('about'))}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-1)] hover:bg-white/20 font-bold text-sky-300"
              >
                {t.aboutTitle}...
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right zone: PWA & Quick buttons */}
      <div className="flex items-center gap-[var(--space-1)].5">
        {/* PWA Install App Button */}
        <PWAInstallButton compact={true} lang={lang} />

        {/* Update notice: only while there is an update to accept or a download
            waiting for its restart, so the bar stays quiet the rest of the time. */}
        <UpdateBadge lang={lang} />

        {/* CMD & Winget Library button */}
        <button
          onClick={() => {
            soundManager.playKeyTick();
            onOpenModal('cmd_winget_library');
          }}
          title={t.cmdLibrary}
          className="px-[var(--space-2)] py-[var(--space-1)] bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 border border-amber-400/40 rounded flex items-center gap-[var(--space-1)] cursor-pointer font-bold transition-colors text-[11px]"
        >
          <Terminal className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden lg:inline">CMD/Winget</span>
        </button>

        {/* CRT is configured from Settings > Display (no external toggle) */}

        {/* Live Digital Clock (Header position) */}
        {showClock && (clockPosition === 'header' || clockPosition === 'both') && (
          <div className="hidden sm:flex items-center gap-[var(--space-1)] bg-black/40 border border-amber-400/40 text-amber-300 font-mono text-[11px] px-[var(--space-2)] py-[var(--space-1)] rounded font-bold shadow-inner">
            <Clock className="w-3 h-3 text-amber-400 animate-pulse" />
            <span>{timeStr}</span>
          </div>
        )}

        {/* Fullscreen Mode Toggle Button */}
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? t.exitFullscreen : t.fullscreenMode}
          className="p-1 bg-black/20 hover:bg-black/40 rounded cursor-pointer text-amber-300 transition-colors"
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>

        {/* Settings button */}
        <button
          onClick={() => {
            soundManager.playKeyTick();
            onOpenModal('settings');
          }}
          title={t.settings}
          className="p-1 bg-black/20 hover:bg-black/30 rounded cursor-pointer"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
