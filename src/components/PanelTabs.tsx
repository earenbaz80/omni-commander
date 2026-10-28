import React from 'react';
import { Plus, X, Lock } from 'lucide-react';
import { PanelTab, LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { soundManager } from '../services/soundEffects';
import { getTranslations } from '../i18n/translations';

interface PanelTabsProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  tabs: PanelTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
  onToggleLockTab: (tabId: string) => void;
  onDuplicateTab: (tabId: string) => void;
  isActive: boolean;
}

export const PanelTabs: React.FC<PanelTabsProps> = ({
  theme,
  lang,
  tabs,
  activeTabId,
  onSelectTab,
  onNewTab,
  onCloseTab,
  isActive,
}) => {
  const t = getTranslations(lang);

  return (
    <div
      className="flex items-center gap-[var(--space-1)] px-[var(--space-1)] pt-1 overflow-x-auto no-scrollbar select-none border-b shrink-0 text-xs font-mono"
      style={{
        backgroundColor: isActive ? theme.bgPanel : theme.bgPanelInactive,
        borderColor: theme.borderPanel,
      }}
    >
      {tabs.map((tab) => {
        const isCurrent = tab.id === activeTabId;
        const shortTitle = tab.currentPath ? tab.currentPath.split('\\').pop() || tab.currentPath : t.tabRoot;

        return (
          <div
            key={tab.id}
            onClick={() => {
              soundManager.playKeyTick();
              onSelectTab(tab.id);
            }}
            className={`group relative flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-1)] rounded-t border-t border-x cursor-pointer transition-colors max-w-[160px] ${
              isCurrent ? 'font-bold shadow-sm' : 'opacity-70 hover:opacity-100 hover:bg-black/20'
            }`}
            style={{
              backgroundColor: isCurrent ? theme.headerBg : 'rgba(0,0,0,0.25)',
              color: isCurrent ? theme.headerText : theme.itemText,
              borderColor: isCurrent ? theme.borderFocus : 'transparent',
            }}
          >
            {/* Lock icon */}
            {tab.isLocked && <Lock className="w-2.5 h-2.5 opacity-80 shrink-0 text-amber-300" />}

            {/* Tab title / path name */}
            <span className="truncate text-xs font-medium" title={tab.currentPath}>
              {shortTitle}
            </span>

            {/* Close button (if more than 1 tab and not locked) */}
            {tabs.length > 1 && !tab.isLocked && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  soundManager.playKeyTick();
                  onCloseTab(tab.id);
                }}
                title={t.closeTab}
                className="opacity-0 group-hover:opacity-100 hover:bg-black/30 p-[var(--space-1)] rounded transition-opacity ml-[var(--space-1)]"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        );
      })}

      {/* New Tab Button */}
      <button
        onClick={() => {
          soundManager.playKeyTick();
          onNewTab();
        }}
        title={t.newTab}
        className="p-[var(--space-1)] hover:bg-black/30 text-white/80 hover:text-white rounded border border-transparent hover:border-white/20 transition-all ml-[var(--space-1)] cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
