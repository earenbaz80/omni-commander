import React, { type Dispatch, type SetStateAction } from 'react';
import type { useAppLock } from '../hooks/useAppLock';
import { CleanupTargetId, fsEngine } from '../services/fileSystem';
import { ThemeConfig } from '../services/themeManager';
import { soundManager } from '../services/soundEffects';
import { getTranslations } from '../i18n/translations';
import { ActiveModal, FileItem, LanguageCode, PanelState, PanelTab, ThemeId, UserSettings } from '../types';
import { HeaderMenuBar } from './HeaderMenuBar';
import { Toolbar } from './Toolbar';

const AppLockModal = React.lazy(() => import('./modals/AppLockModal').then((m) => ({ default: m.AppLockModal })));

export interface WindowChromeProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  settings: UserSettings;
  setSettings: Dispatch<SetStateAction<UserSettings>>;
  activePanel: 'left' | 'right';
  /** The pane the shortcuts act on, and the other one the menu toggles flip. */
  activePanelState: PanelState;
  inactivePanelState: PanelState;
  setLeftPanel: Dispatch<SetStateAction<PanelState>>;
  rightPanel: PanelState;
  setRightPanel: Dispatch<SetStateAction<PanelState>>;
  leftTab: PanelTab;
  rightTab: PanelTab;
  activeFocusedItem: FileItem | null;
  setSelectedFileForModal: Dispatch<SetStateAction<FileItem | null>>;
  setActiveModal: Dispatch<SetStateAction<ActiveModal>>;
  setCleanupTarget: Dispatch<SetStateAction<CleanupTargetId>>;
  setFsTick: Dispatch<SetStateAction<number>>;
  isAppLocked: boolean;
  lockApp: ReturnType<typeof useAppLock>['lock'];
  unlockApp: ReturnType<typeof useAppLock>['unlock'];
  onSelectAll: () => void;
  onInvertSelection: () => void;
  onSwapPanels: () => void;
  onNewTab: (side: 'left' | 'right') => void;
  onSelectDrive: (side: 'left' | 'right', driveId: string) => void;
  onNavigate: (side: 'left' | 'right', path: string) => void;
  runLauncherOpenRequest: number;
  launcherOnly: boolean;
  setLauncherOnly: (value: boolean) => void;
  stackedPanels: boolean;
  /** The window shows a single pane; the layout button then offers the way out. */
  singlePane?: boolean;
}

/**
 * Everything that frames the panes: the CRT overlay, the lock screen, the
 * pull-down menu bar and the toolbar.
 *
 * None of it knows what is selected, only what is on screen, so it takes the
 * panel state (not the files) and writes to settings directly — theme, language,
 * CRT and layout are its own toggles, and keeping them here is what allows App
 * to pass one line per concern instead of five callbacks per widget.
 */
export const WindowChrome: React.FC<WindowChromeProps> = ({
  theme,
  lang,
  settings,
  setSettings,
  activePanel,
  activePanelState,
  inactivePanelState,
  setLeftPanel,
  rightPanel,
  setRightPanel,
  leftTab,
  rightTab,
  activeFocusedItem,
  setSelectedFileForModal,
  setActiveModal,
  setCleanupTarget,
  setFsTick,
  isAppLocked,
  lockApp,
  unlockApp,
  onSelectAll,
  onInvertSelection,
  onSwapPanels,
  onNewTab,
  onSelectDrive,
  onNavigate,
  runLauncherOpenRequest,
  launcherOnly,
  setLauncherOnly,
  stackedPanels,
  singlePane = false,
}) => {
  const t = getTranslations(lang);

  return (
    <>
      {/* Retro CRT Monitor Scanline & Vignette Overlay */}
      {settings.crtEffectEnabled && (
        <div
          className={`fixed inset-0 pointer-events-none z-[9999] ${
            settings.crtIntensity === 'subtle'
              ? 'crt-overlay-subtle'
              : settings.crtIntensity === 'intense'
                ? 'crt-overlay-intense'
                : 'crt-overlay-classic'
          }`}
        />
      )}
      {/* App Lock Overlay if app lock active. It sits above the modal layer
          (ModalShell renders at z-[60] and Settings is mounted later in the tree)
          because enabling the lock from Settings leaves that dialog open: the
          lock has to cover it, not hide underneath it. */}
      {isAppLocked && (
        <div className="fixed inset-0 z-[70]">
          <AppLockModal
            theme={theme}
            lang={lang}
            expectedUser={settings.appUsername || 'admin'}
            expectedPassHash={settings.appPasswordHash}
            expectedPassSalt={settings.appPasswordSalt}
            onUnlockSuccess={unlockApp}
          />
        </div>
      )}

      {/* 1. Retro Pull-down Menu Bar */}
      <HeaderMenuBar
        theme={theme}
        lang={lang}
        showClock={settings.showClock}
        clockPosition={settings.clockPosition}
        hoverOpen={settings.menuBarHoverOpen}
        crtEffectEnabled={settings.crtEffectEnabled}
        onToggleCrt={() => setSettings((s) => ({ ...s, crtEffectEnabled: !s.crtEffectEnabled }))}
        onOpenModal={(m) => {
          if (m === 'viewer' || m === 'editor' || m === 'checksum' || m === 'properties') {
            if (activeFocusedItem) setSelectedFileForModal(activeFocusedItem);
          }
          if (m === 'app_lock') {
            lockApp();
            return;
          }
          setActiveModal(m);
        }}
        onRefresh={() => {
          soundManager.playKeyTick();
          setFsTick((t) => t + 1);
        }}
        onSelectAll={onSelectAll}
        onInvertSelection={onInvertSelection}
        onToggleQuickView={() => {
          soundManager.playKeyTick();
          const targetSet = activePanel === 'left' ? setRightPanel : setLeftPanel;
          targetSet((p) => ({ ...p, isQuickView: !p.isQuickView }));
        }}
        onToggleTree={() => {
          soundManager.playKeyTick();
          const targetSet = activePanel === 'left' ? setLeftPanel : setRightPanel;
          targetSet((p) => ({ ...p, isTreeVisible: !p.isTreeVisible }));
        }}
        onSwapPanels={onSwapPanels}
        onNewTab={(side) => onNewTab(side)}
        onChangeDrive={(side, dId) => onSelectDrive(side, dId)}
        activePanel={activePanel}
        isQuickView={inactivePanelState.isQuickView}
        isTreeVisible={activePanelState.isTreeVisible}
        onSetTheme={(themeId: ThemeId) => setSettings((s) => ({ ...s, theme: themeId }))}
        onSetLang={(newLang: LanguageCode) => setSettings((s) => ({ ...s, language: newLang }))}
        onResetDefaults={() => {
          if (confirm(t.appResetConfirm)) {
            fsEngine.resetToDefaults();
          }
        }}
        onMinimizeWindow={() => {
          const api = window.electronAPI;
          if (api?.minimizeWindow) api.minimizeWindow();
        }}
        onMaximizeWindow={() => {
          const api = window.electronAPI;
          if (api?.maximizeWindow) api.maximizeWindow();
        }}
        onCloseWindow={() => {
          const api = window.electronAPI;
          if (api?.closeWindow) api.closeWindow();
          else window.close();
        }}
      />

      <Toolbar
        currentTheme={theme}
        t={t}
        showToolbar={settings.showToolbar}
        toolbarItems={settings.toolbarItems}
        activePanel={activePanel}
        leftTab={leftTab}
        rightTab={rightTab}
        setLeftPanel={setLeftPanel}
        setRightPanel={setRightPanel}
        setFsTick={setFsTick}
        activeFocusedItem={activeFocusedItem}
        setSelectedFileForModal={setSelectedFileForModal}
        setActiveModal={setActiveModal}
        onCleanup={(target) => {
          setCleanupTarget(target);
          setActiveModal('cleanup');
        }}
        rightPanelShowsDiskUsage={rightPanel.panelView === 'diskUsage'}
        onNavigate={onNavigate}
        runLauncherOpenRequest={runLauncherOpenRequest}
        launcherOnly={launcherOnly}
        onLauncherDismiss={() => setLauncherOnly(false)}
        panelStacked={stackedPanels}
        panelSingle={singlePane}
        onTogglePanelLayout={() =>
          setSettings((s) => ({
            ...s,
            // Three arrangements, one button: side by side, stacked, and the
            // single pane, which returns to the historical columns.
            splitLayout:
              s.splitLayout === 'horizontal' ? 'vertical' : s.splitLayout === 'vertical' ? 'single' : 'horizontal',
          }))
        }
        onToggleRightPanelDiskUsage={() =>
          setRightPanel((p) => ({ ...p, panelView: p.panelView === 'diskUsage' ? 'files' : 'diskUsage' }))
        }
      />
    </>
  );
};
