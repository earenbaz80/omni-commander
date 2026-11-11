import React from 'react';
import {
  FolderPlus,
  Copy,
  Scissors,
  Trash2,
  Search,
  Filter,
  RefreshCw,
  Info,
  FolderTree,
  Trash,
  PanelRight,
  Columns2,
  Rows2,
  Square,
} from 'lucide-react';
import { ThemeConfig } from '../services/themeManager';
import { ActiveModal, FileItem, PanelState, PanelTab } from '../types';
import { soundManager } from '../services/soundEffects';
import { cleanupTargets, CleanupTargetId } from '../services/fileSystem';
import { cleanupTargetLabel } from '../utils/cleanupTargets';
import { resolveToolbarItems } from '../services/toolbarItems';
import { RunLauncher } from './RunLauncher';

interface ToolbarProps {
  currentTheme: ThemeConfig;
  t: Record<string, string>;
  showToolbar: boolean;
  activePanel: 'left' | 'right';
  leftTab: PanelTab;
  rightTab: PanelTab;
  setLeftPanel: React.Dispatch<React.SetStateAction<PanelState>>;
  setRightPanel: React.Dispatch<React.SetStateAction<PanelState>>;
  setFsTick: React.Dispatch<React.SetStateAction<number>>;
  activeFocusedItem: FileItem | null;
  setSelectedFileForModal: React.Dispatch<React.SetStateAction<FileItem | null>>;
  setActiveModal: React.Dispatch<React.SetStateAction<ActiveModal>>;
  /** Opens the cleanup modal for the folder picked in the cleanup menu. */
  onCleanup: (target: CleanupTargetId) => void;
  /** True while the right panel body is the TreeSize view. */
  rightPanelShowsDiskUsage?: boolean;
  onToggleRightPanelDiskUsage?: () => void;
  /** Sends a panel to the folder typed in the Run box. */
  onNavigate: (side: 'left' | 'right', path: string) => void;
  /** Incremented by the app-wide shortcut that opens the Run box. */
  runLauncherOpenRequest?: number;
  /**
   * True while the launcher is the only thing to show: the shortcut asked for it
   * with the toolbar switched off, so the row shrinks to that one line.
   */
  launcherOnly?: boolean;
  /** Closes that one-line row without touching the toolbar setting. */
  onLauncherDismiss?: () => void;
  /** True while the two panes are stacked one above the other. */
  panelStacked?: boolean;
  /** True while only the active pane is on screen. */
  panelSingle?: boolean;
  onTogglePanelLayout?: () => void;
  /**
   * Which commands to show, in order. Undefined means all of them: that is what
   * a profile saved before the row was configurable carries.
   */
  toolbarItems?: string[];
}

/**
 * Quick-action toolbar (new folder, copy, move, delete, search, live filter,
 * refresh, properties).
 *
 * The row used to be a fixed run of buttons, so hiding one meant editing this
 * file. Each command now has an id, the settings file decides which of those ids
 * appear and in what order, and this component only maps an id to its button.
 */
export const Toolbar: React.FC<ToolbarProps> = ({
  currentTheme,
  t,
  showToolbar,
  activePanel,
  leftTab,
  rightTab,
  setLeftPanel,
  setRightPanel,
  setFsTick,
  activeFocusedItem,
  setSelectedFileForModal,
  setActiveModal,
  onCleanup,
  rightPanelShowsDiskUsage = false,
  onToggleRightPanelDiskUsage,
  onNavigate,
  runLauncherOpenRequest,
  launcherOnly = false,
  onLauncherDismiss,
  panelStacked = false,
  panelSingle = false,
  onTogglePanelLayout,
  toolbarItems,
}) => {
  const [cleanupMenuOpen, setCleanupMenuOpen] = React.useState(false);

  // Closes the cleanup menu on a click anywhere else and on Escape. Its own
  // controls stop propagation, so toggling it open is not what closes it again.
  React.useEffect(() => {
    if (!cleanupMenuOpen) return;
    const close = () => setCleanupMenuOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCleanupMenuOpen(false);
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [cleanupMenuOpen]);

  // One launcher element, rendered either in the full row or on its own. The
  // shortcut must reach the line with the toolbar switched off, but reviving the
  // whole row would give the user back a setting they turned off.
  const runLauncher = (
    <RunLauncher
      t={t}
      currentTheme={currentTheme}
      activePanel={activePanel}
      onNavigate={onNavigate}
      openRequest={runLauncherOpenRequest}
      autoFocus={launcherOnly && !showToolbar}
      // Only the row that exists for the launcher can be closed from it; the
      // full toolbar's line is a permanent part of the window.
      onDismiss={showToolbar ? undefined : onLauncherDismiss}
    />
  );

  if (!showToolbar) {
    if (!launcherOnly) return null;
    return (
      <div
        className="flex items-center gap-[var(--space-1)] px-[var(--space-2)] py-[var(--space-1)] border-b shrink-0"
        style={{ backgroundColor: currentTheme.headerBg, borderColor: currentTheme.borderPanel }}
      >
        {runLauncher}
      </div>
    );
  }

  /**
   * Every command the row can show, keyed by the id the settings file stores.
   * An id that needs a prop the caller did not pass draws nothing rather than a
   * button that does not work.
   */
  const commands: Record<string, React.ReactNode> = {
    newFolder: (
      <button
        onClick={() => {
          soundManager.playKeyTick();
          setActiveModal('mkdir');
        }}
        className="px-[var(--space-2)] py-[var(--space-1)] rounded border"
        title={t.toolbarNewFolder}
      >
        <FolderPlus className="w-4 h-4" />
      </button>
    ),
    copy: (
      <button
        onClick={() => {
          soundManager.playKeyTick();
          setActiveModal('copy');
        }}
        className="px-[var(--space-2)] py-[var(--space-1)] rounded border"
        title={t.copy}
      >
        <Copy className="w-4 h-4" />
      </button>
    ),
    move: (
      <button
        onClick={() => {
          soundManager.playKeyTick();
          setActiveModal('move');
        }}
        className="px-[var(--space-2)] py-[var(--space-1)] rounded border"
        title={t.move}
      >
        <Scissors className="w-4 h-4" />
      </button>
    ),
    delete: (
      <button
        onClick={() => {
          soundManager.playKeyTick();
          setActiveModal('delete');
        }}
        className="px-[var(--space-2)] py-[var(--space-1)] rounded border"
        title={t.toolbarDelete}
      >
        <Trash2 className="w-4 h-4" />
      </button>
    ),
    search: (
      <button
        onClick={() => {
          soundManager.playKeyTick();
          setActiveModal('search_grep');
        }}
        className="px-[var(--space-2)] py-[var(--space-1)] rounded border"
        title={t.toolbarSearch}
      >
        <Search className="w-4 h-4" />
      </button>
    ),
    filter: (
      <div className="flex items-center bg-black/50 border border-amber-400/70 rounded px-[var(--space-1)].5 py-[var(--space-1)]">
        <Filter className="w-3 h-3 text-amber-400 mr-[var(--space-1)]" />
        <input
          type="text"
          placeholder={t.toolbarFilterPlaceholder}
          value={activePanel === 'left' ? leftTab.filterText : rightTab.filterText}
          onChange={(e) => {
            const txt = e.target.value;
            if (activePanel === 'left') {
              setLeftPanel((p) => ({
                ...p,
                tabs: p.tabs.map((t) => (t.id === p.activeTabId ? { ...t, filterText: txt } : t)),
              }));
            } else {
              setRightPanel((p) => ({
                ...p,
                tabs: p.tabs.map((t) => (t.id === p.activeTabId ? { ...t, filterText: txt } : t)),
              }));
            }
          }}
          className="w-28 bg-transparent border-none outline-none text-xs text-white font-mono"
        />
      </div>
    ),
    refresh: (
      <button
        onClick={() => {
          soundManager.playKeyTick();
          setFsTick((x: number) => x + 1);
        }}
        className="px-[var(--space-2)] py-[var(--space-1)] rounded border"
        title={t.toolbarRefresh}
      >
        <RefreshCw className="w-4 h-4" />
      </button>
    ),
    properties: (
      <button
        onClick={() => {
          if (activeFocusedItem) {
            setSelectedFileForModal(activeFocusedItem);
            setActiveModal('properties');
          }
        }}
        className="px-[var(--space-2)] py-[var(--space-1)] rounded border"
        title={t.toolbarProperties}
      >
        <Info className="w-4 h-4" />
      </button>
    ),
    diskUsage: (
      <button
        onClick={() => {
          setActiveModal('disk_usage');
        }}
        className="px-[var(--space-2)] py-[var(--space-1)] rounded border bg-amber-900/30"
        title={t.diskUsageTreeTitle}
      >
        <FolderTree className="w-4 h-4 text-amber-300" />
      </button>
    ),
    /*
      The same report as a panel body, so one side can keep browsing while the
      other measures a drive. It only exists for the right panel: the left one
      is the pane the user navigates with.
    */
    diskPane: onToggleRightPanelDiskUsage ? (
      <button
        onClick={() => {
          soundManager.playKeyTick();
          onToggleRightPanelDiskUsage?.();
        }}
        className={`px-[var(--space-2)] py-[var(--space-1)] rounded border mb-0 ${
          rightPanelShowsDiskUsage ? 'bg-amber-400 text-black border-amber-300 font-bold' : 'bg-amber-900/30'
        }`}
        title={rightPanelShowsDiskUsage ? t.diskPaneClose : t.diskPaneOpen}
        aria-pressed={rightPanelShowsDiskUsage}
      >
        <PanelRight className="w-4 h-4" />
      </button>
    ) : null,
    /*
      Arrangement of the two panes. Both layouts are first class, so this is a
      switch and not a preference buried in a dialog: the shape of the window is
      what decides which one is useful today.

     The icon has to picture the arrangement the click produces, like the
     tooltip already did: it used to show the layout already on screen, so the
     button read as "go to columns" while it went to rows.
    */
    layout: onTogglePanelLayout ? (
      <button
        onClick={() => {
          soundManager.playKeyTick();
          onTogglePanelLayout();
        }}
        className={`px-[var(--space-2)] py-[var(--space-1)] rounded border cursor-pointer ${
          panelSingle || panelStacked ? 'bg-amber-400 text-black border-amber-300 font-bold' : 'bg-black/20'
        }`}
        title={panelSingle ? t.panelLayoutColumns : panelStacked ? t.panelLayoutSingle : t.panelLayoutRows}
        aria-pressed={panelSingle || panelStacked}
      >
        {panelSingle ? (
          <Columns2 className="w-4 h-4" />
        ) : panelStacked ? (
          <Square className="w-4 h-4" />
        ) : (
          <Rows2 className="w-4 h-4" />
        )}
      </button>
    ) : null,
    /*
      One entry point for the disposable folders. It replaces a pair of buttons
      that did not do what they said: the "%TEMP%" one opened the disk usage
      modal, and "Limpiar Temp / Prefetch" only raised an alert. The folder list
      comes from the server, which owns the real paths and refuses the two that
      need an elevated token.
    */
    cleanup: (
      <div className="relative">
        <button
          onClick={(event) => {
            event.stopPropagation();
            soundManager.playKeyTick();
            setCleanupMenuOpen((open) => !open);
          }}
          className="px-[var(--space-2)] py-[var(--space-1)] rounded border nc-danger-surface-strong cursor-pointer"
          title={t.toolbarCleanup}
          aria-haspopup="menu"
          aria-expanded={cleanupMenuOpen}
        >
          <Trash className="w-4 h-4 nc-danger-ink" />
        </button>

        {cleanupMenuOpen && (
          <div
            role="menu"
            aria-label={t.toolbarCleanup}
            className="absolute right-0 z-[70] mt-1 min-w-[17rem] rounded border bg-black/95 shadow-lg py-[var(--space-1)]"
            style={{ borderColor: currentTheme.borderPanel }}
          >
            {cleanupTargets.map((entry) => (
              <button
                key={entry.id}
                role="menuitem"
                disabled={entry.requiresAdmin}
                title={entry.requiresAdmin ? t.cleanupRequiresAdmin : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  if (entry.requiresAdmin) return;
                  soundManager.playKeyTick();
                  setCleanupMenuOpen(false);
                  onCleanup(entry.id);
                }}
                className="w-full flex items-center justify-between gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] text-left text-xs cursor-pointer hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="truncate text-white">{cleanupTargetLabel(entry.id, t)}</span>
                {entry.requiresAdmin && (
                  <span className="text-[9px] uppercase tracking-wide shrink-0 text-amber-300/80">
                    {t.cleanupRequiresAdmin}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    ),
  };

  return (
    <div
      className="flex items-center gap-[var(--space-1)] px-[var(--space-2)] py-[var(--space-1)] border-b shrink-0 flex-wrap"
      style={{ backgroundColor: currentTheme.headerBg, borderColor: currentTheme.borderPanel }}
    >
      {resolveToolbarItems(toolbarItems).map((id) => (
        <React.Fragment key={id}>{commands[id] ?? null}</React.Fragment>
      ))}
      {/* The Run line lives at the end of the row and is always visible: it is a
          launcher, not one of the file actions the rest of the toolbar performs,
          so opening it behind a button would only add a click to every command. */}
      {runLauncher}
    </div>
  );
};
