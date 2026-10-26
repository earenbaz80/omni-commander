import React, { useState, useEffect, useMemo } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown, HardDrive, Library, X, Search, FolderTree } from 'lucide-react';
import { ThemeConfig } from '../services/themeManager';
import { Drive, FileItem, LanguageCode } from '../types';
import { fsEngine } from '../services/fileSystem';
import { soundManager } from '../services/soundEffects';
import { getTranslations, tGlobal } from '../i18n/translations';
import { log } from '../utils/logger';

interface TreeNavigationPaneProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  drives: Drive[];
  currentPath: string;
  currentDriveId: string;
  onNavigate: (path: string) => void;
  onSelectDrive: (driveId: string) => void;
  onClose?: () => void;
  onDropItems?: (draggedItems: FileItem[], targetPath: string, targetDriveId: string, operation: 'copy' | 'move') => void;
  // Virtual archive navigation
  archiveRoot?: string;      // Absolute path of the archive file on disk
  virtualPath?: string;      // Current path inside the archive (relative to archive root)
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
  onDropItems?: (draggedItems: FileItem[], targetPath: string, targetDriveId: string, operation: 'copy' | 'move') => void;
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
  searchFilter = ''
}) => {
  const [subdirs, setSubdirs] = useState<FileItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const isExpanded = !!expandedPaths[dirPath];
  const isActive = currentPath === dirPath;
  const isAncestor = currentPath.startsWith(dirPath + '\\');

  // Query subdirectories when expanded
  useEffect(() => {
    if (isExpanded) {
      const dirs = fsEngine.getFiles(driveId, dirPath).filter(f => f.isDirectory);
      setSubdirs(dirs);
    }
  }, [isExpanded, driveId, dirPath]);

  // Auto-subscribe to fsEngine updates
  useEffect(() => {
    if (!isExpanded) return;
    const unsub = fsEngine.subscribe(() => {
      const dirs = fsEngine.getFiles(driveId, dirPath).filter(f => f.isDirectory);
      setSubdirs(dirs);
    });
    return unsub;
  }, [isExpanded, driveId, dirPath]);

  // Filter children
  const filteredSubdirs = searchFilter
    ? subdirs.filter(s => s.name.toLowerCase().includes(searchFilter.toLowerCase()))
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
          <span className={`text-[9px] px-[var(--space-1)] rounded opacity-60 tabular-nums shrink-0 ml-[var(--space-1)] ${isActive ? 'text-black font-bold' : ''}`}>
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
  virtualPath
}) => {
  const t = getTranslations(lang);
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});

  const [searchFilter, setSearchFilter] = useState('');

  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const handleSelectNode = (driveId: string, path: string) => {
    onSelectDrive(driveId);
    onNavigate(path);
  };

  // Quick Libraries / Shortcuts (sin unidades simuladas)
  const mainLibraries: any[] = [];

  // Get virtual archive folders when inside an archive
  const virtualFolders = React.useMemo(() => {
    if (!archiveRoot) return [];
    const allItems = fsEngine.getFiles(currentDriveId, archiveRoot);
    const prefix = virtualPath ? `${archiveRoot}\\${virtualPath}` : archiveRoot;
    return allItems
      .filter(f => f.isDirectory && f.path === prefix)
      .map(f => ({ ...f, displayPath: f.path.slice(archiveRoot.length + 1) }));
  }, [archiveRoot, virtualPath, currentDriveId]);

  return (
    <div 
      className="w-60 md:w-64 flex flex-col h-full border-r shrink-0 font-mono text-xs select-none bg-black/50 overflow-hidden transition-all shadow-inner"
      style={{
        borderColor: theme.borderPanel,
        color: theme.itemText
      }}
    >
      {/* Pane Header */}
      <div 
        className="px-[var(--space-3)] py-[var(--space-2)] font-bold flex items-center justify-between border-b shrink-0 text-[11px]"
        style={{
          backgroundColor: theme.headerBg,
          color: theme.headerText,
          borderColor: theme.borderPanel
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

          {expandedPaths['LIBRARIES'] && (
            <div className="space-y-0.5 pt-0.5">
              {mainLibraries.map((lib, idx) => {
                const Icon = lib.icon;
                const isActive = currentPath === lib.path;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      soundManager.playDiskAccess();
                      handleSelectNode(lib.driveId, lib.path);
                    }}
                    className={`w-full text-left px-[var(--space-2)] py-[var(--space-1)] rounded flex items-center gap-[var(--space-2)] cursor-pointer transition-colors text-[11px] truncate ${
                      isActive ? 'bg-amber-400 text-black font-extrabold shadow' : 'hover:bg-white/10 text-white/90'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-black' : lib.color}`} />
                    <span className="truncate">{lib.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Section: Virtual Archive Folders (when inside an archive) */}
        {archiveRoot && virtualFolders.length > 0 && (
          <div className="space-y-[var(--space-1)]">
            <div className="font-bold text-[10px] uppercase text-emerald-300 opacity-90 pb-1 border-b border-white/10 flex items-center justify-between px-[var(--space-1)]">
              <span className="flex items-center gap-[var(--space-1)]">
                <FolderTree className="w-3 h-3" /> Archive: {archiveRoot?.split('\\').pop()}
                <span className="text-[9px] bg-emerald-900/50 px-1 rounded border border-emerald-400/30">{archiveRoot?.split('.').pop()?.toUpperCase()}</span>
              </span>
              {virtualPath && (
                <span className="text-[9px] opacity-60">
                  {virtualPath.split('\\').length} level(s) deep
                </span>
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
            <span className="text-[9px] opacity-60 tabular-nums">({drives.filter(d => d.isMounted).length})</span>
          </div>

          <div className="space-y-[var(--space-1)] pt-0.5">
            {drives.filter(d => d.isMounted).map(drive => {
              const driveLetter = drive.letter;
              const isDriveExpanded = !!expandedPaths[driveLetter];
              const isDriveActive = currentPath === driveLetter;

              // Read top-level directories of this drive
              const rootDirs = fsEngine.getFiles(drive.id, driveLetter).filter(f => f.isDirectory);
              const filteredRootDirs = searchFilter
                ? rootDirs.filter(r => r.name.toLowerCase().includes(searchFilter.toLowerCase()))
                : rootDirs;

              return (
                <div key={drive.id} className="space-y-0.5">
                  <div
                    onClick={() => {
                      soundManager.playDiskAccess();
                      handleSelectNode(drive.id, driveLetter);
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
                        {isDriveExpanded ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )}
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
