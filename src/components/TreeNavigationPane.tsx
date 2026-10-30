import React, { useState, useEffect, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  HardDrive,
  Library,
  X,
  Search,
  FolderTree,
  Star,
} from 'lucide-react';
import { ThemeConfig } from '../services/themeManager';
import { Drive, FileItem, LanguageCode } from '../types';
import { fsEngine } from '../services/fileSystem';
import { soundManager } from '../services/soundEffects';
import { getTranslations, tGlobal, type TranslationKey } from '../i18n/translations';
import { loadUserFolders, UserFolder, UserFolderKey } from '../services/userFolders';
import { log } from '../utils/logger';

/**
 * Shared empty list. A `= []` default would hand the component a new array on
 * every render, which restarts the existence check below forever.
 */
const NO_FOLDERS: string[] = [];

/** Windows calls these libraries; the tree labels them in the user's language. */
const LIBRARY_LABEL_KEYS: Record<UserFolderKey, TranslationKey> = {
  desktop: 'libraryDesktop',
  documents: 'libraryDocuments',
  pictures: 'libraryPictures',
  music: 'libraryMusic',
  videos: 'libraryVideos',
  downloads: 'libraryDownloads',
};

interface TreeNavigationPaneProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  drives: Drive[];
  currentPath: string;
  currentDriveId: string;
  onNavigate: (path: string) => void;
  onSelectDrive: (driveId: string) => void;
  onClose?: () => void;
  onDropItems?: (
    draggedItems: FileItem[],
    targetPath: string,
    targetDriveId: string,
    operation: 'copy' | 'move',
  ) => void;
  // Virtual archive navigation
  archiveRoot?: string; // Absolute path of the archive file on disk
  virtualPath?: string; // Current path inside the archive (relative to archive root)
  /** Folders the user pinned from the context menu, as absolute paths. */
  favoriteFolders?: string[];
  /** Pinned folders whose folder no longer exists, so the caller can forget them. */
  onMissingFavorites?: (paths: string[]) => void;
}

interface TreeNodeItemProps {
  theme: ThemeConfig;
  driveId: string;
  dirPath: string;
  dirName: string;
  depth: number;
  currentPath: string;
  expandedPaths: Record<string, boolean>;
  onToggleExpand: (path: string) => void;
  onSelectNode: (driveId: string, path: string) => void;
  onDropItems?: (
    draggedItems: FileItem[],
    targetPath: string,
    targetDriveId: string,
    operation: 'copy' | 'move',
  ) => void;
  searchFilter?: string;
}

const TreeNodeItem: React.FC<TreeNodeItemProps> = ({
  theme,
  driveId,
  dirPath,
  dirName,
  depth,
  currentPath,
  expandedPaths,
  onToggleExpand,
  onSelectNode,
  onDropItems,
  searchFilter = '',
}) => {
  const [subdirs, setSubdirs] = useState<FileItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const isExpanded = !!expandedPaths[dirPath];
  const isActive = currentPath === dirPath;
  const isAncestor = currentPath.startsWith(dirPath + '\\');

  // Query subdirectories when expanded
  useEffect(() => {
    if (isExpanded) {
      const dirs = fsEngine.getFiles(driveId, dirPath).filter((f) => f.isDirectory);
      setSubdirs(dirs);
    }
  }, [isExpanded, driveId, dirPath]);

  // Auto-subscribe to fsEngine updates
  useEffect(() => {
    if (!isExpanded) return;
    const unsub = fsEngine.subscribe(() => {
      const dirs = fsEngine.getFiles(driveId, dirPath).filter((f) => f.isDirectory);
      setSubdirs(dirs);
    });
    return unsub;
  }, [isExpanded, driveId, dirPath]);

  // Filter children
  const filteredSubdirs = searchFilter
    ? subdirs.filter((s) => s.name.toLowerCase().includes(searchFilter.toLowerCase()))
    : subdirs;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.shiftKey ? 'move' : 'copy';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    try {
      const data = e.dataTransfer.getData('application/json');
      if (data && onDropItems) {
        const payload = JSON.parse(data);
        if (payload && Array.isArray(payload.items)) {
          const operation = e.shiftKey ? 'move' : 'copy';
          onDropItems(payload.items, dirPath, driveId, operation);
        }
      }
    } catch (err) {
      log.warn('Drop on tree node error:', err);
    }
  };

  return (
    <div className="space-y-0.5 select-none font-mono text-[11px]">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`group flex items-center justify-between py-[var(--space-1)] px-[var(--space-1)] rounded cursor-pointer transition-all ${
          isDragOver
            ? 'ring-2 ring-amber-400 bg-amber-400/30 text-amber-200 font-bold'
            : isActive
              ? 'bg-amber-400 text-black font-extrabold shadow'
              : isAncestor
                ? 'bg-white/10 text-amber-300 font-semibold'
                : 'hover:bg-white/10 text-white/90'
        }`}
        style={{ paddingLeft: `${Math.max(4, depth * 12)}px` }}
        onClick={() => {
          soundManager.playDiskAccess();
          onSelectNode(driveId, dirPath);
        }}
        // A double click opens or closes the branch in place, so a directory can
        // be inspected without leaving the folder the panel is showing.
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          soundManager.playKeyTick();
          onToggleExpand(dirPath);
        }}
      >
        <div className="flex items-center gap-[var(--space-2)] min-w-0 truncate">
          {/* Chevron expander */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              soundManager.playKeyTick();
              onToggleExpand(dirPath);
            }}
            className="w-3.5 h-3.5 flex items-center justify-center hover:bg-black/30 rounded cursor-pointer shrink-0 opacity-70 hover:opacity-100"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-current" />
            ) : (
              <ChevronRight className="w-3 h-3 text-current" />
            )}
          </button>

          {/* Folder icon */}
          {isExpanded ? (
            <FolderOpen className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-black' : 'text-amber-300'}`} />
          ) : (
            <Folder className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-black' : 'text-amber-400'}`} />
          )}

          {/* Name */}
          <span className="truncate">{dirName}</span>
        </div>

        {subdirs.length > 0 && (
          <span
            className={`text-[9px] px-[var(--space-1)] rounded opacity-60 tabular-nums shrink-0 ml-[var(--space-1)] ${isActive ? 'text-black font-bold' : ''}`}
          >
            {subdirs.length}
          </span>
        )}
      </div>

      {/* Recursive children */}
      {isExpanded && (
        <div className="border-l border-white/10 ml-[var(--space-2)].5">
          {filteredSubdirs.map((child) => (
            <TreeNodeItem
              key={child.id}
              theme={theme}
              driveId={driveId}
              dirPath={`${dirPath}\\${child.name}`}
              dirName={child.name}
              depth={depth + 1}
              currentPath={currentPath}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onSelectNode={onSelectNode}
              onDropItems={onDropItems}
              searchFilter={searchFilter}
            />
          ))}

          {filteredSubdirs.length === 0 && (
            <div
              className="text-[10px] opacity-40 italic py-[var(--space-1)]"
              style={{ paddingLeft: `${Math.max(4, (depth + 1) * 12)}px` }}
            >
              {tGlobal('treeNoSubfolders')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const TreeNavigationPane: React.FC<TreeNavigationPaneProps> = ({
  theme,
  lang,
  drives,
  currentPath,
  currentDriveId,
  onNavigate,
  onSelectDrive,
  onClose,
  onDropItems,
  archiveRoot,
  virtualPath,
  favoriteFolders,
  onMissingFavorites,
}) => {
  const pinnedFolders = favoriteFolders ?? NO_FOLDERS;
  const t = getTranslations(lang);
  // Both lists are short and the first thing in the pane, so they start open.
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({
    LIBRARIES: true,
    FAVORITES: true,
  });
  const [userFolders, setUserFolders] = useState<UserFolder[]>([]);
  const [goneFavorites, setGoneFavorites] = useState<string[]>([]);
  // Held in a ref so an inline callback from the caller cannot restart the
  // check on every render, which would ask the server in a loop.
  const missingFavoritesRef = useRef(onMissingFavorites);
  missingFavoritesRef.current = onMissingFavorites;

  const [searchFilter, setSearchFilter] = useState('');

  // Resolved by the server against the signed-in profile, because Desktop and
  // Documents are often redirected into OneDrive.
  //
  // The pane can mount before the local server is listening, and a failure is
  // deliberately not cached, so the arrival of the drive list — the same server
  // answering — is the signal to ask again. Without it a window opened early
  // stayed without libraries for the whole session.
  const serverAnswered = drives.length > 0;
  useEffect(() => {
    let alive = true;
    void loadUserFolders().then((folders) => {
      if (alive) setUserFolders(folders);
    });
    return () => {
      alive = false;
    };
  }, [serverAnswered]);

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const handleSelectNode = (driveId: string, path: string) => {
    onSelectDrive(driveId);
    onNavigate(path);
  };

  // A library is only shown when its drive is mounted, so a path on a drive that
  // is gone cannot be offered; the drive id is what the tree reads listings by.
  const libraries = React.useMemo(() => {
    return userFolders
      .map((folder) => {
        const letter = folder.path.slice(0, 2).toUpperCase();
        const drive = drives.find((d) => d.isMounted && d.letter.toUpperCase() === letter);
        return drive ? { ...folder, driveId: drive.id } : null;
      })
      .filter((entry): entry is UserFolder & { driveId: string } => entry !== null);
  }, [userFolders, drives]);

  // A favourite is checked against the disk so a folder deleted outside the app
  // disappears instead of failing when clicked. Only mounted drives are asked
  // about: an unplugged one must keep its favourite, and a server that cannot
  // answer must not prune anything.
  useEffect(() => {
    let alive = true;
    const mounted = pinnedFolders.filter((folderPath) =>
      drives.some((d) => d.isMounted && d.letter.toUpperCase() === folderPath.slice(0, 2).toUpperCase()),
    );
    if (mounted.length === 0) {
      // React bails out on an unchanged state, so this cannot loop.
      setGoneFavorites((previous) => (previous.length === 0 ? previous : []));
      return;
    }
    void fsEngine.missingFolders(mounted).then((missing) => {
      if (!alive || !missing) return;
      setGoneFavorites((previous) =>
        previous.length === missing.length && previous.every((entry, index) => entry === missing[index])
          ? previous
          : missing,
      );
      if (missing.length > 0) missingFavoritesRef.current?.(missing);
    });
    return () => {
      alive = false;
    };
  }, [pinnedFolders, drives]);

  // A pinned folder is listed by the same rules as a library: it needs a mounted
  // drive, because the tree reads listings by drive id.
  const favorites = React.useMemo(() => {
    const gone = new Set(goneFavorites.map((entry) => entry.toLowerCase()));
    return pinnedFolders
      .filter((folderPath) => !gone.has(folderPath.toLowerCase()))
      .map((folderPath) => {
        const letter = folderPath.slice(0, 2).toUpperCase();
        const drive = drives.find((d) => d.isMounted && d.letter.toUpperCase() === letter);
        if (!drive) return null;
        const name = folderPath.split('\\').filter(Boolean).pop() || folderPath;
        return { path: folderPath, name, driveId: drive.id };
      })
      .filter((entry): entry is { path: string; name: string; driveId: string } => entry !== null);
  }, [pinnedFolders, drives, goneFavorites]);

  // Get virtual archive folders when inside an archive
  const virtualFolders = React.useMemo(() => {
    if (!archiveRoot) return [];
    const allItems = fsEngine.getFiles(currentDriveId, archiveRoot);
    const prefix = virtualPath ? `${archiveRoot}\\${virtualPath}` : archiveRoot;
    return allItems
      .filter((f) => f.isDirectory && f.path === prefix)
      .map((f) => ({ ...f, displayPath: f.path.slice(archiveRoot.length + 1) }));
  }, [archiveRoot, virtualPath, currentDriveId]);

  return (
    <div
      className="w-60 md:w-64 flex flex-col h-full border-r shrink-0 font-mono text-xs select-none bg-black/50 overflow-hidden transition-all shadow-inner"
      style={{
        borderColor: theme.borderPanel,
        color: theme.itemText,
      }}
    >
      {/* Pane Header */}
      <div
        className="px-[var(--space-3)] py-[var(--space-2)] font-bold flex items-center justify-between border-b shrink-0 text-[11px]"
        style={{
          backgroundColor: theme.headerBg,
          color: theme.headerText,
          borderColor: theme.borderPanel,
        }}
      >
        <span className="flex items-center gap-[var(--space-2)] font-extrabold uppercase tracking-wide">
          <FolderTree className="w-3.5 h-3.5" /> Árbol de Carpetas
        </span>
        {onClose && (
          <button
            onClick={onClose}
            title={t.hideTreePanel}
            className="hover:bg-black/20 px-[var(--space-1)] py-[var(--space-1)] rounded cursor-pointer font-bold text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* Live Directory Filter Input */}
      <div className="p-[var(--space-2)] border-b border-white/10 shrink-0 bg-black/40">
        <div className="flex items-center gap-[var(--space-1)] bg-black/60 border border-white/20 rounded px-[var(--space-1)].5 py-[var(--space-1)] focus-within:border-amber-400">
          <Search className="w-3 h-3 text-amber-400 shrink-0" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder={t.filterFolders}
            className="w-full bg-transparent border-none outline-none text-[10px] text-white font-mono placeholder:text-white/40"
          />
          {searchFilter && (
            <button onClick={() => setSearchFilter('')} className="text-white/60 hover:text-white cursor-pointer">
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Tree View Content */}
      <div className="flex-1 overflow-y-auto p-[var(--space-2)] space-y-[var(--space-3)]">
        {/* Section 0: Folders the user pinned from the context menu */}
        {favorites.length > 0 && (
          <div className="space-y-[var(--space-1)]">
            <div
              className="flex items-center justify-between font-bold text-[10px] uppercase text-yellow-300 opacity-90 cursor-pointer hover:opacity-100 px-[var(--space-1)]"
              onClick={() => toggleExpand('FAVORITES')}
            >
              <div className="flex items-center gap-[var(--space-1)]">
                {expandedPaths['FAVORITES'] ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                <span>{t.favorites}</span>
              </div>
              <Star className="w-3 h-3 opacity-60" />
            </div>

            {expandedPaths['FAVORITES'] && (
              <div className="space-y-0.5 pt-0.5">
                {favorites.map((favorite) => (
                  <TreeNodeItem
                    key={favorite.path}
                    theme={theme}
                    driveId={favorite.driveId}
                    dirPath={favorite.path}
                    dirName={favorite.name}
                    depth={0}
                    currentPath={currentPath}
                    expandedPaths={expandedPaths}
                    onToggleExpand={toggleExpand}
                    onSelectNode={handleSelectNode}
                    onDropItems={onDropItems}
                    searchFilter={searchFilter}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Section 1: Main Libraries / Shortcuts */}
        <div className="space-y-[var(--space-1)]">
          <div
            className="flex items-center justify-between font-bold text-[10px] uppercase text-amber-300 opacity-90 cursor-pointer hover:opacity-100 px-[var(--space-1)]"
            onClick={() => toggleExpand('LIBRARIES')}
          >
            <div className="flex items-center gap-[var(--space-1)]">
              {expandedPaths['LIBRARIES'] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span>{t.quickAccess}</span>
            </div>
            <Library className="w-3 h-3 opacity-60" />
          </div>

          {expandedPaths['LIBRARIES'] && libraries.length > 0 && (
            <div className="space-y-0.5 pt-0.5">
              {libraries.map((lib) => (
                <TreeNodeItem
                  key={lib.key}
                  theme={theme}
                  driveId={lib.driveId}
                  dirPath={lib.path}
                  dirName={t[LIBRARY_LABEL_KEYS[lib.key]]}
                  depth={0}
                  currentPath={currentPath}
                  expandedPaths={expandedPaths}
                  onToggleExpand={toggleExpand}
                  onSelectNode={handleSelectNode}
                  onDropItems={onDropItems}
                  searchFilter={searchFilter}
                />
              ))}
            </div>
          )}
        </div>

        {/* Section: Virtual Archive Folders (when inside an archive) */}
        {archiveRoot && virtualFolders.length > 0 && (
          <div className="space-y-[var(--space-1)]">
            <div className="font-bold text-[10px] uppercase text-emerald-300 opacity-90 pb-1 border-b border-white/10 flex items-center justify-between px-[var(--space-1)]">
              <span className="flex items-center gap-[var(--space-1)]">
                <FolderTree className="w-3 h-3" /> Archive: {archiveRoot?.split('\\').pop()}
                <span className="text-[9px] bg-emerald-900/50 px-1 rounded border border-emerald-400/30">
                  {archiveRoot?.split('.').pop()?.toUpperCase()}
                </span>
              </span>
              {virtualPath && (
                <span className="text-[9px] opacity-60">{virtualPath.split('\\').length} level(s) deep</span>
              )}
            </div>
            <div className="space-y-0.5 pt-0.5">
              {virtualFolders.map((folder, idx) => {
                const fullPath = `${archiveRoot}\\${folder.displayPath}`;
                const isActive = currentPath === fullPath;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      soundManager.playDiskAccess();
                      handleSelectNode(currentDriveId, fullPath);
                    }}
                    className={`w-full text-left px-[var(--space-2)] py-[var(--space-1)] rounded flex items-center gap-[var(--space-2)] cursor-pointer transition-colors text-[11px] truncate ${
                      isActive ? 'bg-emerald-400 text-black font-extrabold shadow' : 'hover:bg-white/10 text-white/90'
                    }`}
                  >
                    <Folder className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-black' : 'text-emerald-400'}`} />
                    <span className="truncate">{folder.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Section 2: Drives and Recursive Subdirectories */}
        <div className="space-y-[var(--space-1)]">
          <div className="font-bold text-[10px] uppercase text-cyan-300 opacity-90 pb-1 border-b border-white/10 flex items-center justify-between px-[var(--space-1)]">
            <span className="flex items-center gap-[var(--space-1)]">
              <HardDrive className="w-3 h-3" /> Unidades de Disco
            </span>
            <span className="text-[9px] opacity-60 tabular-nums">({drives.filter((d) => d.isMounted).length})</span>
          </div>

          <div className="space-y-[var(--space-1)] pt-0.5">
            {drives
              .filter((d) => d.isMounted)
              .map((drive) => {
                const driveLetter = drive.letter;
                const isDriveExpanded = !!expandedPaths[driveLetter];
                const isDriveActive = currentPath === driveLetter;

                // Read top-level directories of this drive
                const rootDirs = fsEngine.getFiles(drive.id, driveLetter).filter((f) => f.isDirectory);
                const filteredRootDirs = searchFilter
                  ? rootDirs.filter((r) => r.name.toLowerCase().includes(searchFilter.toLowerCase()))
                  : rootDirs;

                return (
                  <div key={drive.id} className="space-y-0.5">
                    <div
                      onClick={() => {
                        soundManager.playDiskAccess();
                        handleSelectNode(drive.id, driveLetter);
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        soundManager.playKeyTick();
                        toggleExpand(driveLetter);
                      }}
                      className={`flex items-center justify-between px-[var(--space-1)].5 py-[var(--space-1)] rounded cursor-pointer text-[11px] font-bold transition-all ${
                        isDriveActive
                          ? 'bg-sky-950 border border-sky-400 text-sky-200'
                          : 'hover:bg-white/10 text-white/90'
                      }`}
                    >
                      <div className="flex items-center gap-[var(--space-2)] min-w-0 truncate">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            soundManager.playKeyTick();
                            toggleExpand(driveLetter);
                          }}
                          className="w-3.5 h-3.5 flex items-center justify-center hover:bg-black/30 rounded cursor-pointer shrink-0 opacity-70 hover:opacity-100"
                        >
                          {isDriveExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                        <HardDrive className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="font-black text-amber-300">[{driveLetter}]</span>
                        <span className="opacity-75 text-[10px] truncate">{drive.name}</span>
                      </div>

                      {rootDirs.length > 0 && (
                        <span className="text-[9px] opacity-60 tabular-nums shrink-0 ml-[var(--space-1)]">
                          {rootDirs.length}
                        </span>
                      )}
                    </div>

                    {/* Subdirectories for this drive */}
                    {isDriveExpanded && (
                      <div className="border-l border-white/10 ml-[var(--space-2)].5">
                        {filteredRootDirs.map((sub) => (
                          <TreeNodeItem
                            key={sub.id}
                            theme={theme}
                            driveId={drive.id}
                            dirPath={`${driveLetter}\\${sub.name}`}
                            dirName={sub.name}
                            depth={1}
                            currentPath={currentPath}
                            expandedPaths={expandedPaths}
                            onToggleExpand={toggleExpand}
                            onSelectNode={handleSelectNode}
                            onDropItems={onDropItems}
                            searchFilter={searchFilter}
                          />
                        ))}

                        {filteredRootDirs.length === 0 && (
                          <div className="text-[10px] opacity-40 italic pl-4 py-[var(--space-1)]">
                            {t.treeEmptyDisk}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
};
