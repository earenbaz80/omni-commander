import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Folder, HardDrive } from 'lucide-react';
import { Drive, FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import { fsEngine } from '../../services/fileSystem';

import ModalShell from '../ModalShell';

interface ChooseFolderModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  /** What is being sent, shown so the dialog says what it is copying. */
  itemName: string;
  driveId: string;
  /** Opens on the other panel's folder: that panel is the destination picker. */
  startPath: string;
  /** Real drives only, listed so the copy can land on a different disk. */
  drives: Drive[];
  /**
   * Folder the last copy landed in, remembered across sessions. It wins over
   * the panel's own location, which is only the first-run default.
   */
  rememberedFolder?: string;
  onConfirm: (folderPath: string) => void;
  onClose: () => void;
}

/**
 * Folder picker for "Enviar a > Elegir carpeta…". It browses with a stack
 * instead of computing parents: the app has no single spelling for a location
 * (a typed path is relative, a double-clicked one absolute), and popping the
 * stack cannot get that wrong. For the same reason switching drive resets the
 * stack to that drive's root instead of rewriting the current path.
 */
export const ChooseFolderModal: React.FC<ChooseFolderModalProps> = ({
  theme,
  lang,
  itemName,
  driveId,
  startPath,
  drives,
  rememberedFolder,
  onConfirm,
  onClose,
}) => {
  const t = getTranslations(lang);

  const realDrives = useMemo(() => drives.filter((drive) => drive.id.startsWith('real_') && drive.isMounted), [drives]);

  // The remembered folder is only usable if its drive is plugged in right now.
  // A remembered path from a removed stick is ignored here rather than probed:
  // nothing has to be asked of the disk to know it is unreachable.
  const remembered = useMemo(() => {
    const match = /^([A-Za-z]):/.exec(String(rememberedFolder || '').trim());
    if (!match) return null;
    const letter = `${match[1].toUpperCase()}:`;
    const drive = realDrives.find((candidate) => candidate.letter.toUpperCase() === letter);
    return drive ? { driveId: drive.id, path: String(rememberedFolder).trim() } : null;
  }, [rememberedFolder, realDrives]);

  const [activeDriveId, setActiveDriveId] = useState(remembered?.driveId ?? driveId);
  const [stack, setStack] = useState<string[]>([remembered?.path ?? startPath]);
  const [folders, setFolders] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  // The remembered folder may have been renamed or deleted since last time. Its
  // first listing decides; a fallback still pending is not re-armed later, or a
  // folder the user deleted on purpose would be silently replaced every time.
  const fallbackPending = useRef(!!remembered);

  const currentPath = stack[stack.length - 1];

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void (async () => {
      const listed = await fsEngine.loadSystemDriveDirectory(activeDriveId, currentPath);
      if (!alive) return;
      const wasRemembered = fallbackPending.current;
      fallbackPending.current = false;
      if (!listed && wasRemembered && (activeDriveId !== driveId || currentPath !== startPath)) {
        setActiveDriveId(driveId);
        setStack([startPath]);
        return;
      }
      setFolders(
        fsEngine
          .getFiles(activeDriveId, currentPath)
          .filter((item) => item.isDirectory)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [activeDriveId, currentPath, driveId, startPath]);

  const enter = (folder: FileItem) => {
    soundManager.playDiskAccess();
    setStack((prev) => [...prev, `${currentPath}\\${folder.name}`]);
  };

  const goUp = () => {
    soundManager.playKeyTick();
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  };

  const switchDrive = (drive: Drive) => {
    soundManager.playDiskAccess();
    setActiveDriveId(drive.id);
    setStack([drive.letter]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    soundManager.playDiskAccess();
    onConfirm(currentPath);
  };

  return (
    <ModalShell title={t.chooseFolderTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div className="font-mono select-none">
        <form onSubmit={handleSubmit} className="p-[var(--space-4)] space-y-[var(--space-3)]">
          <div className="text-xs">
            <span className="opacity-75">{t.chooseFolderCopyOf} </span>
            <strong className="text-white">{itemName}</strong>
            <div className="mt-[var(--space-1)] break-all opacity-90">{currentPath || '\\'}</div>
          </div>

          {realDrives.length > 0 && (
            <div className="flex items-center gap-[var(--space-1)] flex-wrap text-xs">
              <span className="opacity-75 shrink-0">{t.chooseFolderDrive}</span>
              {realDrives.map((drive) => {
                const selected = drive.id === activeDriveId;
                return (
                  <button
                    key={drive.id}
                    type="button"
                    onClick={() => switchDrive(drive)}
                    title={`${drive.letter} ${drive.name}${drive.fileSystem ? ` [${drive.fileSystem}]` : ''}`}
                    className={`px-[var(--space-2)] py-[var(--space-1)] rounded font-bold flex items-center gap-[var(--space-1)] cursor-pointer ${
                      selected
                        ? 'bg-amber-400 text-black shadow-inner font-extrabold ring-1 ring-amber-300'
                        : 'bg-black/30 hover:bg-black/50 text-white/90 border border-white/20'
                    }`}
                  >
                    <HardDrive className={`w-3 h-3 ${selected ? 'text-black' : 'text-blue-300'}`} />
                    <span>[{drive.letter}]</span>
                  </button>
                );
              })}
            </div>
          )}

          <div
            className="h-56 overflow-y-auto border rounded"
            style={{ borderColor: theme.modalBorder, backgroundColor: theme.modalBg }}
          >
            {stack.length > 1 && (
              <button
                type="button"
                onClick={goUp}
                className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/10 flex items-center gap-[var(--space-2)] cursor-pointer"
              >
                <ArrowUp className="w-3.5 h-3.5 text-amber-300" /> ..
              </button>
            )}

            {loading && <div className="px-[var(--space-3)] py-[var(--space-2)] opacity-60">{t.contentLoading}</div>}

            {!loading && folders.length === 0 && (
              <div className="px-[var(--space-3)] py-[var(--space-2)] opacity-60">{t.chooseFolderEmpty}</div>
            )}

            {!loading &&
              folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => enter(folder)}
                  className="w-full text-left px-[var(--space-3)] py-[var(--space-2)] hover:bg-white/10 flex items-center gap-[var(--space-2)] cursor-pointer truncate"
                >
                  <Folder className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="truncate">{folder.name}</span>
                </button>
              ))}
          </div>

          <div className="flex items-center justify-end gap-[var(--space-2)] pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-[var(--space-4)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
            >
              {t.btnCancel} (Esc)
            </button>
            <button
              type="submit"
              className="px-5 py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
            >
              {t.chooseFolderCopyHere}
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
};
