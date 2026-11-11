import React from 'react';
import { ThemeConfig } from '../services/themeManager';
import type { ModalData } from '../types';
import {
  ActiveModal,
  CommandHistoryItem,
  Drive,
  FileItem,
  FolderPasswordRecord,
  LanguageCode,
  PanelState,
  PanelTab,
  TransferOptions,
  TransferPlan,
  UserSettings,
} from '../types';
import { CleanupTargetId, fsEngine, type OpenableArchiveFormat } from '../services/fileSystem';
import { TaskQueueBar } from './TaskQueueBar';
import { OfflineIndicator } from './OfflineIndicator';

const ViewerModal = React.lazy(() => import('./modals/ViewerModal').then((m) => ({ default: m.ViewerModal })));
const EditorModal = React.lazy(() => import('./modals/EditorModal').then((m) => ({ default: m.EditorModal })));
const CopyMoveModal = React.lazy(() => import('./modals/CopyMoveModal').then((m) => ({ default: m.CopyMoveModal })));
const MkDirModal = React.lazy(() => import('./modals/MkDirModal').then((m) => ({ default: m.MkDirModal })));
const ChooseFolderModal = React.lazy(() =>
  import('./modals/ChooseFolderModal').then((m) => ({ default: m.ChooseFolderModal })),
);
const DeleteModal = React.lazy(() => import('./modals/DeleteModal').then((m) => ({ default: m.DeleteModal })));
const BatchRenameModal = React.lazy(() =>
  import('./modals/BatchRenameModal').then((m) => ({ default: m.BatchRenameModal })),
);
const DiffCompareModal = React.lazy(() =>
  import('./modals/DiffCompareModal').then((m) => ({ default: m.DiffCompareModal })),
);
const SearchGrepModal = React.lazy(() =>
  import('./modals/SearchGrepModal').then((m) => ({ default: m.SearchGrepModal })),
);
const ChecksumModal = React.lazy(() => import('./modals/ChecksumModal').then((m) => ({ default: m.ChecksumModal })));
const ZipArchiveModal = React.lazy(() =>
  import('./modals/ZipArchiveModal').then((m) => ({ default: m.ZipArchiveModal })),
);
const DiskUsageModal = React.lazy(() => import('./modals/DiskUsageModal').then((m) => ({ default: m.DiskUsageModal })));
const CleanupModal = React.lazy(() => import('./modals/CleanupModal').then((m) => ({ default: m.CleanupModal })));
const PropertiesModal = React.lazy(() =>
  import('./modals/PropertiesModal').then((m) => ({ default: m.PropertiesModal })),
);
const SettingsModal = React.lazy(() => import('./modals/SettingsModal').then((m) => ({ default: m.SettingsModal })));
const HelpModal = React.lazy(() => import('./modals/HelpModal').then((m) => ({ default: m.HelpModal })));
const AboutModal = React.lazy(() => import('./modals/AboutModal').then((m) => ({ default: m.AboutModal })));
const UserMenuModal = React.lazy(() => import('./modals/UserMenuModal').then((m) => ({ default: m.UserMenuModal })));
const QuitModal = React.lazy(() => import('./modals/QuitModal').then((m) => ({ default: m.QuitModal })));
const ProtectFolderModal = React.lazy(() =>
  import('./modals/ProtectFolderModal').then((m) => ({ default: m.ProtectFolderModal })),
);
const UnlockFolderModal = React.lazy(() =>
  import('./modals/UnlockFolderModal').then((m) => ({ default: m.UnlockFolderModal })),
);
const SyncFoldersModal = React.lazy(() =>
  import('./modals/SyncFoldersModal').then((m) => ({ default: m.SyncFoldersModal })),
);
const FTPManagerModal = React.lazy(() =>
  import('./modals/FTPManagerModal').then((m) => ({ default: m.FTPManagerModal })),
);
const FileSplitterJoinerModal = React.lazy(() =>
  import('./modals/FileSplitterJoinerModal').then((m) => ({ default: m.FileSplitterJoinerModal })),
);
const CmdWingetLibraryModal = React.lazy(() =>
  import('./modals/CmdWingetLibraryModal').then((m) => ({ default: m.CmdWingetLibraryModal })),
);
const BookmarksHotlistModal = React.lazy(() =>
  import('./modals/BookmarksHotlistModal').then((m) => ({ default: m.BookmarksHotlistModal })),
);
const RecycleBinModal = React.lazy(() =>
  import('./modals/RecycleBinModal').then((m) => ({ default: m.RecycleBinModal })),
);
const BackgroundTasksModal = React.lazy(() =>
  import('./modals/BackgroundTasksModal').then((m) => ({ default: m.BackgroundTasksModal })),
);
const ArchiveInfoModal = React.lazy(() =>
  import('./modals/ArchiveInfoModal').then((m) => ({ default: m.ArchiveInfoModal })),
);
const CalculatorModal = React.lazy(() =>
  import('./modals/CalculatorModal').then((m) => ({ default: m.CalculatorModal })),
);
const CalendarModal = React.lazy(() => import('./modals/CalendarModal').then((m) => ({ default: m.CalendarModal })));
const ImageStudioModal = React.lazy(() =>
  import('./modals/ImageStudioModal').then((m) => ({ default: m.ImageStudioModal })),
);
const MapsModal = React.lazy(() => import('./modals/MapsModal').then((m) => ({ default: m.MapsModal })));
const TerminalModal = React.lazy(() => import('./modals/TerminalModal').then((m) => ({ default: m.TerminalModal })));
const ShareModal = React.lazy(() => import('./modals/ShareModal').then((m) => ({ default: m.ShareModal })));
const BrowserModal = React.lazy(() => import('./modals/BrowserModal').then((m) => ({ default: m.BrowserModal })));

type UnlockTarget = {
  side: 'left' | 'right';
  path: string;
  record: FolderPasswordRecord;
};

interface AppModalsProps {
  currentTheme: ThemeConfig;
  lang: LanguageCode;
  selectedFileForModal: FileItem | null;
  setActiveModal: React.Dispatch<React.SetStateAction<ActiveModal>>;
  activeModal: ActiveModal;
  cleanupTarget: CleanupTargetId;
  modalData: ModalData | null;
  setModalData: React.Dispatch<React.SetStateAction<ModalData | null>>;
  currentActiveTab: PanelTab;
  currentInactiveTab: PanelTab;
  activePanel: 'left' | 'right';
  activeItems: FileItem[];
  activeFocusedItem: FileItem | null;
  leftTab: PanelTab;
  rightTab: PanelTab;
  leftItems: FileItem[];
  rightItems: FileItem[];
  drives: Drive[];
  settings: UserSettings;
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>;
  unlockTarget: UnlockTarget | null;
  setUnlockTarget: React.Dispatch<React.SetStateAction<UnlockTarget | null>>;
  setLeftPanel: React.Dispatch<React.SetStateAction<PanelState>>;
  setRightPanel: React.Dispatch<React.SetStateAction<PanelState>>;
  setFsTick: React.Dispatch<React.SetStateAction<number>>;
  handleConfirmCopy: (targetPath: string, options: TransferOptions) => string | undefined | Promise<string | undefined>;
  handleConfirmMove: (targetPath: string, options: TransferOptions) => string | undefined | Promise<string | undefined>;
  handleElevateTransfer: (
    op: 'copy' | 'move',
    targetPath: string,
    options: TransferOptions,
  ) => Promise<{ ok: boolean; reason?: string } | undefined>;
  handleConfirmDelete: () => void;
  handleConfirmMkDir: (dirName: string) => void;
  handleConfirmNewFile: (fileName: string) => void;
  handleConfirmRename: (newName: string) => void;
  handleConfirmSendToFolder: (folderPath: string) => Promise<void>;
  handleApplyBatchRename: (renames: { id: string; newName: string }[]) => void;
  getSelectedOrFocusedItems: () => FileItem[];
  handleNavigate: (panelSide: 'left' | 'right', newPath: string) => void;
  handleSelectIndex: (panelSide: 'left' | 'right', index: number) => void;
  handleCompressZip: (archiveName: string, format: OpenableArchiveFormat) => Promise<void>;
  handleExtractZip: (zipFile: FileItem) => Promise<void>;
  handleSetFolderPassword: (folderPath: string, password: string | null) => void | Promise<void>;
  handleExecuteCommand: (cmd: string) => void;
  onRunCopyList: (plans: TransferPlan[]) => void;
  /** The shell's log, shared with the command bar it also belongs to. */
  commandHistory: CommandHistoryItem[];
  onClearHistory: () => void;
  isAdminMode: boolean;
  onRequestElevation?: () => void;
}

/**
 * Host for every modal/dialog and the floating overlays (task queue bar, offline
 * indicator). Extracted from App to keep the main component focused.
 */
export const AppModals: React.FC<AppModalsProps> = ({
  currentTheme,
  lang,
  selectedFileForModal,
  setActiveModal,
  activeModal,
  cleanupTarget,
  modalData,
  setModalData,
  currentActiveTab,
  currentInactiveTab,
  activePanel,
  activeItems,
  activeFocusedItem,
  leftTab,
  rightTab,
  leftItems,
  rightItems,
  drives,
  settings,
  setSettings,
  unlockTarget,
  setUnlockTarget,
  setLeftPanel,
  setRightPanel,
  setFsTick,
  handleConfirmCopy,
  handleConfirmMove,
  handleElevateTransfer,
  handleConfirmDelete,
  handleConfirmMkDir,
  handleConfirmNewFile,
  handleConfirmRename,
  handleConfirmSendToFolder,
  handleApplyBatchRename,
  getSelectedOrFocusedItems,
  handleNavigate,
  handleSelectIndex,
  handleCompressZip,
  handleExtractZip,
  handleSetFolderPassword,
  handleExecuteCommand,
  onRunCopyList,
  commandHistory,
  onClearHistory,
  isAdminMode,
  onRequestElevation,
}) => {
  return (
    <>
      {/* 8. Modals & Dialogs */}
      <React.Suspense fallback={null}>
        {activeModal === 'viewer' && selectedFileForModal && (
          <ViewerModal
            theme={currentTheme}
            lang={lang}
            file={selectedFileForModal}
            initialTab={modalData?.viewerTab === 'preview' ? 'preview' : 'text'}
            onClose={() => setActiveModal(null)}
            onEdit={() => setActiveModal('editor')}
          />
        )}

        {activeModal === 'editor' && selectedFileForModal && (
          <EditorModal
            theme={currentTheme}
            lang={lang}
            file={selectedFileForModal}
            onSave={(fileId, content) => fsEngine.saveFileContent(fileId, content)}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'copy' && (
          <CopyMoveModal
            type="copy"
            theme={currentTheme}
            lang={lang}
            items={modalData?.items || []}
            sourcePath={currentActiveTab.currentPath}
            targetPath={currentInactiveTab.currentPath}
            targetDriveId={currentInactiveTab.driveId}
            onConfirm={handleConfirmCopy}
            onElevate={(targetPath, options) => handleElevateTransfer('copy', targetPath, options)}
            onLoadCopyList={onRunCopyList}
            onClose={() => {
              setActiveModal(null);
              setModalData(null);
            }}
          />
        )}

        {activeModal === 'move' && (
          <CopyMoveModal
            type="move"
            theme={currentTheme}
            lang={lang}
            items={modalData?.items || []}
            sourcePath={currentActiveTab.currentPath}
            targetPath={currentInactiveTab.currentPath}
            targetDriveId={currentInactiveTab.driveId}
            onConfirm={handleConfirmMove}
            onElevate={(targetPath, options) => handleElevateTransfer('move', targetPath, options)}
            onLoadCopyList={onRunCopyList}
            onClose={() => {
              setActiveModal(null);
              setModalData(null);
            }}
          />
        )}

        {activeModal === 'delete' && (
          <DeleteModal
            theme={currentTheme}
            lang={lang}
            items={modalData?.items || []}
            onConfirm={handleConfirmDelete}
            onClose={() => {
              setActiveModal(null);
              setModalData(null);
            }}
          />
        )}

        {activeModal === 'mkdir' && (
          <MkDirModal
            theme={currentTheme}
            lang={lang}
            currentPath={currentActiveTab.currentPath}
            onConfirm={handleConfirmMkDir}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'new_file' && (
          <MkDirModal
            theme={currentTheme}
            lang={lang}
            currentPath={currentActiveTab.currentPath}
            isNewFile={true}
            onConfirm={handleConfirmNewFile}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'rename' && selectedFileForModal && (
          <MkDirModal
            theme={currentTheme}
            lang={lang}
            currentPath={currentActiveTab.currentPath}
            isRename={true}
            initialName={
              selectedFileForModal.fullName ||
              `${selectedFileForModal.name}${selectedFileForModal.ext ? `.${selectedFileForModal.ext}` : ''}`
            }
            onConfirm={handleConfirmRename}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'choose_folder' && selectedFileForModal && (
          <ChooseFolderModal
            theme={currentTheme}
            lang={lang}
            itemName={
              selectedFileForModal.fullName ||
              `${selectedFileForModal.name}${selectedFileForModal.ext ? `.${selectedFileForModal.ext}` : ''}`
            }
            driveId={modalData?.sendToDriveId || currentInactiveTab.driveId}
            startPath={modalData?.sendToPath ?? currentInactiveTab.currentPath}
            drives={drives}
            rememberedFolder={settings.sendToLastFolder}
            onConfirm={handleConfirmSendToFolder}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'batch_rename' && (
          <BatchRenameModal
            theme={currentTheme}
            lang={lang}
            items={getSelectedOrFocusedItems()}
            onApplyRename={handleApplyBatchRename}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'diff_compare' && (
          <DiffCompareModal
            theme={currentTheme}
            lang={lang}
            leftFile={leftItems[leftTab.focusedIndex] || null}
            rightFile={rightItems[rightTab.focusedIndex] || null}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'search_grep' && (
          <SearchGrepModal
            theme={currentTheme}
            lang={lang}
            currentDriveId={currentActiveTab.driveId}
            currentPath={currentActiveTab.currentPath}
            onSelectFile={(file) => {
              handleNavigate(activePanel, file.path);
              const idx = activeItems.findIndex((i) => i.id === file.id);
              if (idx >= 0) handleSelectIndex(activePanel, idx);
            }}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'checksum' && selectedFileForModal && (
          <ChecksumModal
            theme={currentTheme}
            lang={lang}
            file={selectedFileForModal}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'zipArchive' && (
          <ZipArchiveModal
            theme={currentTheme}
            lang={lang}
            selectedItems={
              fsEngine.getArchiveSource(currentActiveTab.driveId, currentActiveTab.currentPath)
                ? [fsEngine.getArchiveSource(currentActiveTab.driveId, currentActiveTab.currentPath)!]
                : getSelectedOrFocusedItems()
            }
            targetDriveId={currentActiveTab.driveId}
            targetPath={
              fsEngine.getArchiveSource(currentActiveTab.driveId, currentActiveTab.currentPath)
                ? currentInactiveTab.currentPath
                : currentActiveTab.currentPath
            }
            onCompress={handleCompressZip}
            onExtract={handleExtractZip}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'disk_usage' && (
          <DiskUsageModal
            theme={currentTheme}
            lang={lang}
            drives={drives}
            driveId={currentActiveTab.driveId}
            rootPath={currentActiveTab.currentPath}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'cleanup' && (
          <CleanupModal theme={currentTheme} lang={lang} target={cleanupTarget} onClose={() => setActiveModal(null)} />
        )}

        {activeModal === 'properties' && selectedFileForModal && (
          <PropertiesModal
            theme={currentTheme}
            lang={lang}
            file={selectedFileForModal}
            onUpdateAttributes={(fId, attr) => {
              const f = fsEngine.getFileById(fId);
              if (f) {
                f.attributes = attr;
                fsEngine.saveToStorage();
              }
            }}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'settings' && (
          <SettingsModal
            theme={currentTheme}
            lang={lang}
            settings={settings}
            onUpdateSettings={(newS) => setSettings((prev) => ({ ...prev, ...newS }))}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'share' && (
          <ShareModal
            theme={currentTheme}
            lang={lang}
            startFolder={modalData?.shareFolderPath ?? currentActiveTab.currentPath}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'browser' && (
          <BrowserModal theme={currentTheme} lang={lang} onClose={() => setActiveModal(null)} />
        )}

        {activeModal === 'help' && <HelpModal theme={currentTheme} lang={lang} onClose={() => setActiveModal(null)} />}

        {activeModal === 'about' && (
          <AboutModal
            theme={currentTheme}
            lang={lang}
            authorName={settings.authorName}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'user_menu' && (
          <UserMenuModal
            theme={currentTheme}
            lang={lang}
            onOpenModal={(m) => setActiveModal(m)}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'protect_folder' && (
          <ProtectFolderModal
            theme={currentTheme}
            lang={lang}
            folderPath={modalData?.targetFolderPath || currentActiveTab.currentPath}
            isAlreadyProtected={
              !!(
                settings.protectedFolders &&
                settings.protectedFolders[modalData?.targetFolderPath || currentActiveTab.currentPath]
              )
            }
            onSetFolderPassword={handleSetFolderPassword}
            onClose={() => {
              setActiveModal(null);
              setModalData(null);
            }}
          />
        )}

        {activeModal === 'unlock_folder' && unlockTarget && (
          <UnlockFolderModal
            theme={currentTheme}
            lang={lang}
            folderPath={unlockTarget.path}
            record={unlockTarget.record}
            onUpgrade={(password) => void handleSetFolderPassword(unlockTarget.path, password)}
            onSuccess={() => {
              setActiveModal(null);
              const side = unlockTarget.side;
              const targetPath = unlockTarget.path;
              const targetSet = side === 'left' ? setLeftPanel : setRightPanel;
              targetSet((p) => ({
                ...p,
                tabs: p.tabs.map((tab) => {
                  if (tab.id !== p.activeTabId) return tab;
                  const newHistory = [...tab.history.slice(0, tab.historyIndex + 1), targetPath];
                  return {
                    ...tab,
                    currentPath: targetPath,
                    history: newHistory,
                    historyIndex: newHistory.length - 1,
                    selectedIds: [],
                    focusedIndex: 0,
                    filterText: '',
                  };
                }),
              }));
              setUnlockTarget(null);
            }}
            onClose={() => {
              setActiveModal(null);
              setUnlockTarget(null);
            }}
          />
        )}

        {activeModal === 'sync_folders' && (
          <SyncFoldersModal
            theme={currentTheme}
            lang={lang}
            leftDriveId={leftTab.driveId}
            leftPath={leftTab.currentPath}
            leftItems={leftItems}
            rightDriveId={rightTab.driveId}
            rightPath={rightTab.currentPath}
            rightItems={rightItems}
            onSyncComplete={() => {
              setFsTick((t) => t + 1);
            }}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'ftp_manager' && (
          <FTPManagerModal theme={currentTheme} lang={lang} onClose={() => setActiveModal(null)} />
        )}

        {(activeModal === 'file_splitter' || activeModal === 'file_joiner') && (
          <FileSplitterJoinerModal
            theme={currentTheme}
            lang={lang}
            mode={activeModal === 'file_joiner' ? 'join' : 'split'}
            sourceFile={selectedFileForModal || activeFocusedItem}
            targetDriveId={currentInactiveTab.driveId}
            targetPath={currentInactiveTab.currentPath}
            onComplete={() => {
              setFsTick((t) => t + 1);
            }}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'cmd_winget_library' && (
          <CmdWingetLibraryModal
            theme={currentTheme}
            lang={lang}
            onClose={() => setActiveModal(null)}
            onRunInTerminal={(cmdStr) => {
              handleExecuteCommand(cmdStr);
              setActiveModal(null);
            }}
          />
        )}

        {activeModal === 'hotlist_bookmarks' && (
          <BookmarksHotlistModal
            theme={currentTheme}
            lang={lang}
            currentPath={currentActiveTab.currentPath}
            currentDriveId={currentActiveTab.driveId}
            onNavigate={(p) => handleNavigate(activePanel, p)}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'recycle_bin' && (
          <RecycleBinModal
            theme={currentTheme}
            lang={lang}
            onRefresh={() => setFsTick((t) => t + 1)}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'background_tasks' && (
          <BackgroundTasksModal
            theme={currentTheme}
            lang={lang}
            onRunCopyList={onRunCopyList}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'archive_info' && selectedFileForModal && (
          <ArchiveInfoModal
            theme={currentTheme}
            lang={lang}
            fileName={`${selectedFileForModal.name}${selectedFileForModal.ext ? `.${selectedFileForModal.ext}` : ''}`}
            fileSize={selectedFileForModal.size || 0}
            fileDate={new Date(selectedFileForModal.modifiedAt || Date.now())}
            onExtractAll={() => {
              setActiveModal('zipArchive');
            }}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'quit' && (
          <QuitModal
            theme={currentTheme}
            lang={lang}
            onConfirmQuit={() => {
              setActiveModal(null);
            }}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'calculator' && (
          <CalculatorModal theme={currentTheme} lang={lang} onClose={() => setActiveModal(null)} />
        )}

        {activeModal === 'calendar' && (
          <CalendarModal theme={currentTheme} lang={lang} onClose={() => setActiveModal(null)} />
        )}

        {activeModal === 'image_studio' && (selectedFileForModal || activeFocusedItem) && (
          <ImageStudioModal
            theme={currentTheme}
            lang={lang}
            file={selectedFileForModal || activeFocusedItem}
            onSaved={() => setFsTick((tick) => tick + 1)}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal === 'maps' && <MapsModal theme={currentTheme} lang={lang} onClose={() => setActiveModal(null)} />}

        {activeModal === 'terminal' && (
          <TerminalModal
            theme={currentTheme}
            lang={lang}
            currentPath={currentActiveTab.currentPath}
            commandHistory={commandHistory}
            onExecuteCommand={handleExecuteCommand}
            onClearHistory={onClearHistory}
            isAdminMode={isAdminMode}
            onRequestElevation={onRequestElevation}
            onClose={() => setActiveModal(null)}
          />
        )}

        {/* Floating Background Task Queue Bar */}
        {activeModal !== 'copy' && activeModal !== 'move' && (
          <TaskQueueBar onOpenTasksModal={() => setActiveModal('copy')} lang={lang} theme={currentTheme} />
        )}

        {/* Offline Status Indicator */}
        <OfflineIndicator lang={lang} />
      </React.Suspense>
    </>
  );
};
