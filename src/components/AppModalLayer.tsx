import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
  ActiveModal,
  CommandHistoryItem,
  Drive,
  FileItem,
  FolderPasswordRecord,
  LanguageCode,
  ModalData,
  PanelState,
  PanelTab,
  UserSettings,
} from '../types';
import { CleanupTargetId } from '../services/fileSystem';
import { ThemeConfig } from '../services/themeManager';
import { getTranslations } from '../i18n/translations';
import type { useFileOperations } from '../hooks/useFileOperations';
import type { useTransferQueue } from '../hooks/useTransferQueue';
import { AppModals } from './AppModals';
import { ConflictPromptModal } from './modals/ConflictPromptModal';
import { FreeSpaceModal } from './modals/FreeSpaceModal';
import { ZipPasswordModal } from './modals/ZipPasswordModal';

/** A folder password the user has to retype before the modal acts on it. */
type UnlockTarget = {
  side: 'left' | 'right';
  path: string;
  record: FolderPasswordRecord;
};

/** What every dialog below needs to paint itself, and the one setter Settings owns. */
export interface ModalLayerLook {
  theme: ThemeConfig;
  lang: LanguageCode;
  settings: UserSettings;
  setSettings: Dispatch<SetStateAction<UserSettings>>;
}

/** The panes the dialogs read to say what they will act on, plus the selection getter. */
export interface ModalLayerPanels {
  activePanel: 'left' | 'right';
  activeItems: FileItem[];
  activeFocusedItem: FileItem | null;
  currentActiveTab: PanelTab;
  currentInactiveTab: PanelTab;
  leftTab: PanelTab;
  rightTab: PanelTab;
  leftItems: FileItem[];
  rightItems: FileItem[];
  drives: Drive[];
  setLeftPanel: Dispatch<SetStateAction<PanelState>>;
  setRightPanel: Dispatch<SetStateAction<PanelState>>;
  setFsTick: Dispatch<SetStateAction<number>>;
  /** Selection or focused item, which is what F-keys and the menu act on. */
  selection: () => FileItem[];
}

/** Which dialog is open and what it was opened for. */
export interface ModalLayerStack {
  activeModal: ActiveModal;
  setActiveModal: Dispatch<SetStateAction<ActiveModal>>;
  modalData: ModalData | null;
  setModalData: Dispatch<SetStateAction<ModalData | null>>;
  selectedFileForModal: FileItem | null;
  unlockTarget: UnlockTarget | null;
  setUnlockTarget: Dispatch<SetStateAction<UnlockTarget | null>>;
  cleanupTarget: CleanupTargetId;
}

/**
 * The transfer engine and the prompts it raises on its own: a collision and a
 * short destination are questions the queue asks mid-operation, so the answers
 * are the queue's own callbacks and not a second path to the same decision.
 */
export interface ModalLayerTransfers {
  /** The selection a transfer dialog is working on. */
  items: FileItem[];
  queue: ReturnType<typeof useTransferQueue>;
  passwordRequest: { fileName: string; invalid: boolean } | null;
  submitPassword: (value: string | null) => void;
}

/** The file operations the dialogs confirm, taken straight from their hook. */
type ModalLayerFiles = Pick<
  ReturnType<typeof useFileOperations>,
  | 'handleConfirmDelete'
  | 'handleConfirmMkDir'
  | 'handleConfirmNewFile'
  | 'handleConfirmRename'
  | 'handleConfirmSendToFolder'
  | 'handleApplyBatchRename'
  | 'handleCompressZip'
  | 'handleExtractZip'
  | 'extractConflict'
  | 'handleResolveExtractConflict'
  | 'handleAbortExtractConflict'
  | 'handleSetFolderPassword'
>;

/** The few entries the dialogs borrow from the panels, the console and the command line. */
export interface ModalLayerCommands {
  navigate: (side: 'left' | 'right', path: string) => void;
  selectIndex: (panelSide: 'left' | 'right', index: number) => void;
  executeCommand: (command: string) => void;
  /** The shell's log and how to empty it: the terminal window shows the same one. */
  history: CommandHistoryItem[];
  clearHistory: () => void;
  isAdminMode: boolean;
  /** Relaunching elevated is the shell's one move it cannot do to itself. */
  requestElevation: () => void;
}

/** The folder-tree handle pinned to the window edge; it is not part of any pane. */
export interface ModalLayerTreeHandle {
  visible: boolean;
  onToggle: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
}

export interface AppModalLayerProps {
  ui: ModalLayerLook;
  panels: ModalLayerPanels;
  modal: ModalLayerStack;
  transfers: ModalLayerTransfers;
  files: ModalLayerFiles;
  commands: ModalLayerCommands;
  treeHandle: ModalLayerTreeHandle;
}

/**
 * Every dialog the window can show, in the order they stack: the modal the user
 * opened, then the prompts a transfer raises over it, then the tree handle.
 *
 * They are here together because they share one rule that is easy to break when
 * they live apart: a dialog opened from another one must land above it, and a
 * question asked mid-transfer must not be replaced by a second one.
 */
export function AppModalLayer({ ui, panels, modal, transfers, files, commands, treeHandle }: AppModalLayerProps) {
  const t = getTranslations(ui.lang);
  const { queue } = transfers;

  // A transfer dialog can be open before the queue publishes its list, so an
  // empty snapshot borrows the queue's items instead of showing nothing.
  const modalData = modal.modalData?.items?.length ? modal.modalData : { ...modal.modalData, items: transfers.items };

  return (
    <>
      <AppModals
        currentTheme={ui.theme}
        lang={ui.lang}
        settings={ui.settings}
        setSettings={ui.setSettings}
        activeModal={modal.activeModal}
        setActiveModal={modal.setActiveModal}
        modalData={modalData}
        setModalData={modal.setModalData}
        selectedFileForModal={modal.selectedFileForModal}
        cleanupTarget={modal.cleanupTarget}
        unlockTarget={modal.unlockTarget}
        setUnlockTarget={modal.setUnlockTarget}
        activePanel={panels.activePanel}
        activeItems={panels.activeItems}
        activeFocusedItem={panels.activeFocusedItem}
        currentActiveTab={panels.currentActiveTab}
        currentInactiveTab={panels.currentInactiveTab}
        leftTab={panels.leftTab}
        rightTab={panels.rightTab}
        leftItems={panels.leftItems}
        rightItems={panels.rightItems}
        drives={panels.drives}
        setLeftPanel={panels.setLeftPanel}
        setRightPanel={panels.setRightPanel}
        setFsTick={panels.setFsTick}
        getSelectedOrFocusedItems={panels.selection}
        handleNavigate={commands.navigate}
        handleSelectIndex={commands.selectIndex}
        handleExecuteCommand={commands.executeCommand}
        commandHistory={commands.history}
        onClearHistory={commands.clearHistory}
        isAdminMode={commands.isAdminMode}
        onRequestElevation={commands.requestElevation}
        onRunCopyList={queue.handleRunCopyList}
        handleConfirmCopy={queue.handleConfirmCopy}
        handleConfirmMove={queue.handleConfirmMove}
        handleElevateTransfer={queue.handleElevateTransfer}
        handleConfirmDelete={files.handleConfirmDelete}
        handleConfirmMkDir={files.handleConfirmMkDir}
        handleConfirmNewFile={files.handleConfirmNewFile}
        handleConfirmRename={files.handleConfirmRename}
        handleConfirmSendToFolder={files.handleConfirmSendToFolder}
        handleApplyBatchRename={files.handleApplyBatchRename}
        handleCompressZip={files.handleCompressZip}
        handleExtractZip={files.handleExtractZip}
        handleSetFolderPassword={files.handleSetFolderPassword}
      />

      {files.extractConflict && (
        <ConflictPromptModal
          conflict={files.extractConflict}
          theme={ui.theme}
          lang={ui.lang}
          onAnswer={files.handleResolveExtractConflict}
          onCancel={files.handleAbortExtractConflict}
        />
      )}

      {queue.conflictPrompt && (
        <ConflictPromptModal
          conflict={queue.conflictPrompt}
          theme={ui.theme}
          lang={ui.lang}
          onAnswer={queue.handleResolveConflict}
          onCancel={queue.handleAbortConflict}
        />
      )}

      {queue.freeSpacePrompt && (
        <FreeSpaceModal
          volumes={queue.freeSpacePrompt.volumes}
          theme={ui.theme}
          lang={ui.lang}
          onForce={queue.handleForceTransfer}
          onCancel={queue.dismissFreeSpacePrompt}
        />
      )}

      {transfers.passwordRequest && (
        <ZipPasswordModal
          theme={ui.theme}
          lang={ui.lang}
          fileName={transfers.passwordRequest.fileName}
          invalid={transfers.passwordRequest.invalid}
          onSubmit={transfers.submitPassword}
          onClose={() => transfers.submitPassword(null)}
        />
      )}

      <button
        ref={treeHandle.buttonRef}
        onClick={treeHandle.onToggle}
        className="fixed left-0 top-1/2 -translate-y-1/2 z-[10000] w-6 h-14 rounded-r-md border border-l-0 text-[11px] font-bold flex items-center justify-center cursor-pointer shadow-lg"
        style={{ backgroundColor: ui.theme.headerBg, color: ui.theme.headerText, borderColor: ui.theme.borderPanel }}
        title={t.toggleTreeTooltip}
      >
        {treeHandle.visible ? '◁' : '▷'}
      </button>
    </>
  );
}
