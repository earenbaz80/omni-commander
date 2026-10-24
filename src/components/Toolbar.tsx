import React from 'react';
import { FolderPlus, Copy, Scissors, Trash2, Search, Filter, RefreshCw, Info } from 'lucide-react';
import { ThemeConfig } from '../services/themeManager';
import { ActiveModal, FileItem, PanelState, PanelTab } from '../types';
import { soundManager } from '../services/soundEffects';

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
}

/**
 * Quick-action toolbar (new folder, copy, move, delete, search, live filter,
 * refresh, properties). Extracted from App to keep the component focused.
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
}) => {
  if (!showToolbar) return null;

  return (
    <div className='flex items-center gap-[var(--space-1)] px-[var(--space-2)] py-[var(--space-1)] border-b shrink-0 flex-wrap' style={{ backgroundColor: currentTheme.headerBg, borderColor: currentTheme.borderPanel }}>
      <button onClick={() => { soundManager.playKeyTick(); setActiveModal('mkdir'); }} className='px-[var(--space-2)] py-[var(--space-1)] rounded border' title={t.toolbarNewFolder}>
        <FolderPlus className='w-4 h-4' />
      </button>
      <button onClick={() => { soundManager.playKeyTick(); setActiveModal('copy'); }} className='px-[var(--space-2)] py-[var(--space-1)] rounded border' title={t.copy}>
        <Copy className='w-4 h-4' />
      </button>
      <button onClick={() => { soundManager.playKeyTick(); setActiveModal('move'); }} className='px-[var(--space-2)] py-[var(--space-1)] rounded border' title={t.move}>
        <Scissors className='w-4 h-4' />
      </button>
      <button onClick={() => { soundManager.playKeyTick(); setActiveModal('delete'); }} className='px-[var(--space-2)] py-[var(--space-1)] rounded border' title={t.toolbarDelete}>
        <Trash2 className='w-4 h-4' />
      </button>
      <button onClick={() => { soundManager.playKeyTick(); setActiveModal('search_grep'); }} className='px-[var(--space-2)] py-[var(--space-1)] rounded border' title={t.toolbarSearch}>
        <Search className='w-4 h-4' />
      </button>
      <div className='flex items-center bg-black/50 border border-amber-400/70 rounded px-[var(--space-1)].5 py-[var(--space-1)]'>
        <Filter className='w-3 h-3 text-amber-400 mr-[var(--space-1)]' />
        <input
          type='text'
          placeholder={t.toolbarFilterPlaceholder}
          value={activePanel === 'left' ? leftTab.filterText : rightTab.filterText}
          onChange={(e) => {
            const txt = e.target.value;
            if (activePanel === 'left') {
              setLeftPanel((p) => ({ ...p, tabs: p.tabs.map((t) => t.id === p.activeTabId ? { ...t, filterText: txt } : t) }));
            } else {
              setRightPanel((p) => ({ ...p, tabs: p.tabs.map((t) => t.id === p.activeTabId ? { ...t, filterText: txt } : t) }));
            }
          }}
          className='w-28 bg-transparent border-none outline-none text-xs text-white font-mono'
        />
      </div>
      <button onClick={() => { soundManager.playKeyTick(); setFsTick((x: number) => x + 1); }} className='px-[var(--space-2)] py-[var(--space-1)] rounded border' title={t.toolbarRefresh}>
        <RefreshCw className='w-4 h-4' />
      </button>
      <button onClick={() => { if (activeFocusedItem) { setSelectedFileForModal(activeFocusedItem); setActiveModal('properties'); } }} className='px-[var(--space-2)] py-[var(--space-1)] rounded border' title={t.toolbarProperties}>
        <Info className='w-4 h-4' />
      </button>
    </div>
  );
};
