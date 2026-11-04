import React, { type Dispatch, type SetStateAction } from 'react';
import { ContextMenu } from './ContextMenu';
import { ActiveModal, FileItem, LanguageCode, ModalData, PanelTab, UserSettings } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { fsEngine } from '../services/fileSystem';
import { soundManager } from '../services/soundEffects';
import { consoleCommandFor } from '../services/appOpeners';

/** What the menu is open on: where it was clicked and what it was clicked over. */
export interface FileContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  targetItem: FileItem | null;
  panelSide: 'left' | 'right';
}

export interface FileContextMenuProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  state: FileContextMenuState;
  settings: UserSettings;
  currentActiveTab: PanelTab;
  leftTab: PanelTab;
  rightTab: PanelTab;
  onClose: () => void;
  setSelectedFileForModal: Dispatch<SetStateAction<FileItem | null>>;
  setActiveModal: Dispatch<SetStateAction<ActiveModal>>;
  setModalData: Dispatch<SetStateAction<ModalData | null>>;
  setSettings: Dispatch<SetStateAction<UserSettings>>;
  onCopy: () => void;
  onMove: () => void;
  onDelete: () => void;
  /** Re-reads the folder the menu was opened over. */
  onRefresh: () => void;
  /** Brings the command console forward, for "open in terminal". */
  onShowConsole: () => void;
  onExecuteCommand: (command: string) => Promise<void>;
}

/** An absolute path for a folder the user can pin; a file has no entry in the tree. */
export function favoritePath(item: FileItem): string {
  return `${item.path}\\${item.name}`;
}

/**
 * The file context menu, wired to the engine and the modal stack.
 *
 * Extracted from App, which had ~30 closures over engine, settings and the modal
 * setters inline in its JSX. Nothing here is new behaviour: the menu still opens
 * the same dialogs on the same target, and the target is read from the state
 * snapshot the menu is drawn from, so a panel that navigates while the menu is
 * open cannot retarget a command that was already chosen.
 */
export const FileContextMenu: React.FC<FileContextMenuProps> = ({
  theme,
  lang,
  state,
  settings,
  currentActiveTab,
  leftTab,
  rightTab,
  onClose,
  setSelectedFileForModal,
  setActiveModal,
  setModalData,
  setSettings,
  onCopy,
  onMove,
  onDelete,
  onRefresh,
  onShowConsole,
  onExecuteCommand,
}) => {
  if (!state.visible) return null;

  const item = state.targetItem;

  /** Opens one of the app's own tools on the item the menu was opened over. */
  const openTool = (modal: ActiveModal) => {
    if (!item) return;
    setSelectedFileForModal(item);
    setActiveModal(modal);
  };

  return (
    <ContextMenu
      theme={theme}
      lang={lang}
      x={state.x}
      y={state.y}
      targetItem={item}
      onClose={onClose}
      onView={() => openTool('viewer')}
      onEdit={() => openTool('editor')}
      onCopy={onCopy}
      onMove={onMove}
      onDelete={onDelete}
      onRename={() => openTool('rename')}
      onMkDir={() => setActiveModal('mkdir')}
      onNewFile={() => {
        setModalData({ isNewFile: true });
        setActiveModal('new_file');
      }}
      onZip={() => setActiveModal('zipArchive')}
      onChecksum={() => openTool('checksum')}
      onProperties={() => openTool('properties')}
      onDownload={() => {
        if (!item) return;
        const blob = new Blob([item.content || ''], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${item.name}.${item.ext || 'txt'}`;
        a.click();
        URL.revokeObjectURL(url);
      }}
      onUpload={() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) {
            await fsEngine.importBrowserFile(file, currentActiveTab.driveId, currentActiveTab.currentPath);
            soundManager.playSuccess();
          }
        };
        input.click();
      }}
      onRefresh={onRefresh}
      onProtectFolder={() => {
        if (item && item.isDirectory) {
          setModalData({ targetFolderPath: favoritePath(item) });
        } else {
          setModalData({ targetFolderPath: currentActiveTab.currentPath });
        }
        setActiveModal('protect_folder');
      }}
      onSplitFile={() => openTool('file_splitter')}
      onArchiveInfo={() => openTool('archive_info')}
      canOpenWith={!!item && !item.isDirectory && fsEngine.isRealFile(item)}
      loadOpenWithPrograms={() => (item ? fsEngine.openWithPrograms(item) : Promise.resolve([]))}
      onOpenWithProgram={(program) => {
        if (!item) return;
        void (async () => {
          try {
            if (await fsEngine.openWithProgram(item, program.id)) return;
            alert(fsEngine.lastServerError || `No se pudo abrir el archivo con ${program.name}`);
          } catch {
            alert(`No se pudo contactar con el servidor para abrir el archivo con ${program.name}`);
          }
        })();
      }}
      onOpenWith={() => {
        if (!item) return;
        // The dialog belongs to the shell and can still be refused (a path the
        // server will not hand to a program, an unregistered type), so the
        // answer is surfaced instead of dropped: silence is what made this look
        // like a dead menu item.
        void (async () => {
          try {
            if (await fsEngine.openWith(item)) return;
            alert(fsEngine.lastServerError || 'No se pudo abrir el diálogo «Abrir con»');
          } catch {
            // A request that never got an answer rejects instead of returning
            // false, and an unhandled rejection is just as silent as the dead
            // menu item this used to look like.
            alert('No se pudo contactar con el servidor para abrir el diálogo «Abrir con»');
          }
        })();
      }}
      canSendTo={!!item && fsEngine.isSystemDrive(item.driveId) && !item.archiveRoot}
      onOpenInApp={(target) => {
        if (!item) return;
        if (target === 'terminal') {
          // The console prints the file in place; no window is launched.
          onShowConsole();
          void onExecuteCommand(consoleCommandFor(item));
          return;
        }
        setSelectedFileForModal(item);
        setModalData(target === 'media' ? { viewerTab: 'preview' } : null);
        setActiveModal(target === 'image' ? 'image_studio' : target === 'media' ? 'viewer' : 'editor');
      }}
      onSendTo={(destination) => {
        if (!item) return;
        void (async () => {
          const created = await fsEngine.sendTo(destination, item);
          if (created) {
            soundManager.playSuccess();
            return;
          }
          alert(fsEngine.lastServerError || 'No se pudo enviar el elemento');
        })();
      }}
      onSendToFolder={() => {
        if (!item) return;
        // The other pane is the destination picker, whichever pane is active.
        const other = state.panelSide === 'left' ? rightTab : leftTab;
        setSelectedFileForModal(item);
        setModalData({ sendToDriveId: other.driveId, sendToPath: other.currentPath });
        setActiveModal('choose_folder');
      }}
      // A folder is pinned by its absolute path, which is what the tree lists.
      isFavorite={!!item?.isDirectory && (settings.favoriteFolders ?? []).includes(favoritePath(item))}
      onToggleFavorite={() => {
        if (!item?.isDirectory) return;
        const target = favoritePath(item);
        setSettings((s) => {
          const current = s.favoriteFolders ?? [];
          const next = current.includes(target) ? current.filter((entry) => entry !== target) : [...current, target];
          return { ...s, favoriteFolders: next };
        });
        soundManager.playSuccess();
      }}
    />
  );
};
