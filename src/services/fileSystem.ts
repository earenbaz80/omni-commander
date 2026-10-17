import JSZip from 'jszip';
import { Drive, FileItem, RecycleBinItem } from '../types';
import { handleStore } from './handleStore';
import { log } from '../utils/logger';
import { tGlobal } from '../i18n/translations';
import { calculateFileHashes as calculateFileHashesImpl } from './fileSystemCrypto';

const STORAGE_KEY = 'nc_filesystem_v1';
const DRIVES_STORAGE_KEY = 'nc_drives_v1';
const RECYCLE_BIN_STORAGE_KEY = 'nc_recycle_bin_v1';

// In the packaged Electron app the renderer is loaded from file://, so relative
// /api/* requests never reach the embedded server. Resolve against the local
// server's absolute URL when running inside Electron; keep relative paths in
// dev/web mode where Vite proxies /api to http://127.0.0.1:3001.
const API_BASE =
  typeof window !== 'undefined' && (window as any).electronAPI?.isElectron
    ? 'http://127.0.0.1:3001'
    : '';

// Initial Virtual Drives
export const initialDrives: Drive[] = [];

// Initial Virtual Files & Folders
export const initialFiles: FileItem[] = [];
class FileSystemEngine {
  private drives: Drive[] = [];
  private files: FileItem[] = [];
  private recycleBin: RecycleBinItem[] = [];
  private listeners: Array<() => void> = [];

  // Real Physical Directory Handles (HTML5 File System Access API)
  private mountedHandles: { [driveId: string]: any } = {};
  private activeSyncingPaths: { [key: string]: boolean } = {};
  private storageSaveTimer: ReturnType<typeof setTimeout> | null = null;

  // Index of files by `${driveId}|${normalizedPath}` for O(1) getFiles lookups.
  private filesVersion = 0;
  private filesIndexVersion = -1;
  private filesIndex = new Map<string, FileItem[]>();

  constructor() {
    this.loadFromStorage();
    this.restoreRealHandles();
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flushStorage());
    }
  }

  private async restoreRealHandles() {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return;
    try {
      const driveIds = ['drive_c', 'drive_d', 'drive_e', 'drive_host'];
      for (const id of driveIds) {
        const handle = await handleStore.get(id);
        if (handle) {
          this.mountedHandles[id] = handle;
          const drive = this.drives.find(d => d.id === id);
          const realDrive = {
            id,
            letter: drive?.letter || 'Z:',
            name: tGlobal('fsHostDriveName').replace('{name}', handle.name),
            type: 'host_fs' as any,
            totalBytes: 1024 * 1024 * 1024 * 1024,
            freeBytes: 500 * 1024 * 1024 * 1024,
            description: tGlobal('fsHostDriveDesc').replace('{name}', handle.name),
            isMounted: true
          };
          if (drive) {
            Object.assign(drive, realDrive);
          } else {
            this.drives.push(realDrive as any);
          }
        }
      }
      this.saveToStorage();
    } catch (e) {
      log.warn("Failed to restore real handles", e);
    }
  }

  public async requestPermissionForDrive(driveId: string): Promise<boolean> {
    const handle = this.mountedHandles[driveId];
    if (!handle) return false;
    if (typeof window !== 'undefined' && window.self !== window.top) {
      return false;
    }
    try {
      const opt = { mode: 'readwrite' };
      const status = await handle.requestPermission(opt);
      if (status === 'granted') {
        const drive = this.getDrive(driveId);
        if (drive) {
          await this.syncRealDirectory(driveId, drive.letter);
        }
        return true;
      }
    } catch (e) {
      log.warn("Permission request info:", e);
    }
    return false;
  }

  public hasRealHandle(driveId: string): boolean {
    return !!this.mountedHandles[driveId];
  }

  private async resolvePhysicalPath(rootHandle: any, path: string, create: boolean = false): Promise<any> {
    let cleanPath = path.replace(/^[a-zA-Z]:/, '').trim();
    if (cleanPath.startsWith('\\')) {
      cleanPath = cleanPath.substring(1);
    }
    if (!cleanPath) return rootHandle;

    const segments = cleanPath.split('\\').filter(Boolean);
    let current = rootHandle;
    for (const segment of segments) {
      current = await current.getDirectoryHandle(segment, { create });
    }
    return current;
  }

  public async syncRealDirectory(driveId: string, path: string): Promise<void> {
    const rootHandle = this.mountedHandles[driveId];
    if (!rootHandle) return;

    const syncKey = `${driveId}::${path}`;
    if (this.activeSyncingPaths[syncKey]) return;
    this.activeSyncingPaths[syncKey] = true;

    try {
      const dirHandle = await this.resolvePhysicalPath(rootHandle, path, false);
      const items: FileItem[] = [];
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

      for await (const entry of dirHandle.values()) {
        const isDirectory = entry.kind === 'directory';
        let size = 0;
        let modifiedAt = now;
        let ext = '';
        let name = entry.name;
        let content = '';

        if (!isDirectory) {
          try {
            const file = await entry.getFile();
            size = file.size;
            modifiedAt = new Date(file.lastModified).toISOString().replace('T', ' ').substring(0, 19);
            
            // Read contents of small text files to enable editing and viewing
            if (size < 500 * 1024) {
              try {
                content = await file.text();
              } catch { /* ignore */ }
            }
          } catch (e) {
            log.warn("Could not read file properties/contents", entry.name, e);
          }
          const parts = entry.name.split('.');
          ext = parts.length > 1 ? parts.pop()!.toUpperCase() : '';
          name = parts.join('.');
        } else {
          // Compute real recursive directory size for mounted File System Access trees
          try {
            const calculateDirectorySize = (async function walk(handle: any): Promise<number> {
              let total = 0;
              try {
                for await (const child of handle.values()) {
                  if (child.kind === 'file') {
                    try {
                      const file = await child.getFile();
                      total += Number(file.size) || 0;
                    } catch { /* ignore */ }
                  } else if (child.kind === 'directory') {
                    total += await walk(child);
                  }
                }
              } catch { /* ignore */ }
              return total;
            });
            size = await calculateDirectorySize(entry);
          } catch (e) {
            log.warn("Could not calculate directory size", entry.name, e);
          }
        }

        items.push({
          id: `real_${driveId}_${entry.name}_${isDirectory ? 'dir' : 'file'}_${Date.now()}`,
          name,
          ext,
          path: this.normalizePath(path),
          driveId,
          isDirectory,
          size,
          modifiedAt,
          createdAt: modifiedAt,
          attributes: { readOnly: false, hidden: entry.name.startsWith('.'), system: false, archive: !isDirectory },
          content,
          isCloud: false
        });
      }

      // Overwrite the cache in memory
      const normPath = this.normalizePath(path);
      this.files = [
        ...this.files.filter(f => !(f.driveId === driveId && this.normalizePath(f.path) === normPath)),
        ...items
      ];
      this.saveToStorage();
    } catch (err) {
      log.warn("Could not sync physical directory", path, err);
    } finally {
      delete this.activeSyncingPaths[syncKey];
    }
  }

  private loadFromStorage() {
    if (typeof window === 'undefined') {
      this.drives = [...initialDrives];
      this.files = [...initialFiles];
      this.recycleBin = [];
      return;
    }

    try {
      const savedDrives = localStorage.getItem(DRIVES_STORAGE_KEY);
      const savedFiles = localStorage.getItem(STORAGE_KEY);
      const savedTrash = localStorage.getItem(RECYCLE_BIN_STORAGE_KEY);

      if (savedDrives) {
        this.drives = JSON.parse(savedDrives);
      } else {
        // Real drives only: do not seed virtual drives
        this.drives = [];
      }

      if (savedFiles) {
        this.files = JSON.parse(savedFiles);
      } else {
        this.files = [];
      }

      if (savedTrash) {
        this.recycleBin = JSON.parse(savedTrash);
      } else {
        this.recycleBin = [];
      }
    } catch {
      this.drives = [...initialDrives];
      this.files = [...initialFiles];
      this.recycleBin = [];
    }
  }

  private persistToStorageNow() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(DRIVES_STORAGE_KEY, JSON.stringify(this.drives));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.files));
      localStorage.setItem(RECYCLE_BIN_STORAGE_KEY, JSON.stringify(this.recycleBin));
    } catch (e) {
      console.error('Failed to save to localStorage', e);
    }
  }

  public flushStorage() {
    if (this.storageSaveTimer) {
      clearTimeout(this.storageSaveTimer);
      this.storageSaveTimer = null;
      this.persistToStorageNow();
    }
  }

  public saveToStorage() {
    // Notify React immediately; debounce the expensive localStorage writes.
    this.filesVersion++;
    this.notify();
    if (typeof window === 'undefined') return;
    if (this.storageSaveTimer) {
      clearTimeout(this.storageSaveTimer);
    }
    this.storageSaveTimer = setTimeout(() => {
      this.persistToStorageNow();
      this.storageSaveTimer = null;
    }, 250);
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  public getDrives(): Drive[] {
    return [...this.drives];
  }

  public async loadSystemDriveDirectory(driveId: string, path: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/api/list?driveId=${encodeURIComponent(driveId)}&path=${encodeURIComponent(path)}`);
      if (!response.ok) return;
      const serverItems = await response.json();
      if (!Array.isArray(serverItems)) return;

      const normPath = this.normalizePath(path);
      const untouched = this.files.filter((f) => !(f.driveId === driveId && this.normalizePath(f.path) === normPath));
      const mapped: FileItem[] = serverItems.map((item: any, index: number) => ({
        id: `sys_${driveId}_${index}_${Date.now()}`,
        name: item.name,
        ext: item.ext || '',
        path: normPath,
        driveId,
        isDirectory: !!item.isDirectory,
        size: Number(item.size) || 0,
        modifiedAt: item.modifiedAt || '',
        createdAt: item.createdAt || '',
        attributes: item.attributes || {
          readOnly: false,
          hidden: String(item.name || '').startsWith('.'),
          system: false,
          archive: !item.isDirectory
        },
        content: item.content || ''
      }));

      this.files = [...untouched, ...mapped];
      this.saveToStorage();
    } catch (e) {
      log.warn('Could not list system directory', path, e);
    }
  }

  public getSearchIndex(searchAllDrives: boolean = false, currentDriveId: string = ''): FileItem[] {
    // Centralized indexed access instead of reaching private internals.
    const files = [...this.files];
    if (searchAllDrives) return files;
    return files.filter(file => file.driveId === currentDriveId);
  }

  public setDrives(next: Drive[]) {
    this.drives = Array.isArray(next) ? next : [];
    this.saveToStorage();
  }

  public async loadRealDrivesFromApi() {
    try {
      const response = await fetch(`${API_BASE}/api/drives`);
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data)) {
        this.setDrives(data);
      }
    } catch (e) {
      log.warn('Could not load real drives from API', e);
    }
  }

  public getDrive(driveId: string): Drive | undefined {
    return this.drives.find(d => d.id === driveId);
  }

  public getDriveByLetter(letter: string): Drive | undefined {
    const formatted = letter.endsWith(':') ? letter : `${letter}:`;
    return this.drives.find(d => d.letter.toUpperCase() === formatted.toUpperCase());
  }

  public mountDrive(driveId: string, isMounted: boolean = true) {
    const drive = this.drives.find(d => d.id === driveId);
    if (drive) {
      drive.isMounted = isMounted;
      this.saveToStorage();
    }
  }

  public getFiles(driveId: string, currentPath: string): FileItem[] {
    if (this.filesIndexVersion !== this.filesVersion) {
      this.filesIndex.clear();
      for (const f of this.files) {
        const key = `${f.driveId}|${this.normalizePath(f.path)}`;
        const bucket = this.filesIndex.get(key);
        if (bucket) bucket.push(f);
        else this.filesIndex.set(key, [f]);
      }
      this.filesIndexVersion = this.filesVersion;
    }
    return this.filesIndex.get(`${driveId}|${this.normalizePath(currentPath)}`) || [];
  }

  public getFileById(id: string): FileItem | undefined {
    return this.files.find(f => f.id === id);
  }

  public normalizePath(path: string): string {
    if (!path) return '';
    let p = path.replace(/\//g, '\\').trim();
    // remove trailing slash unless it's just "C:" or "C:\"
    if (p.endsWith('\\') && p.length > 3) {
      p = p.slice(0, -1);
    }
    return p;
  }

  public getParentPath(path: string): string {
    const norm = this.normalizePath(path);
    const lastSlash = norm.lastIndexOf('\\');
    if (lastSlash === -1 || lastSlash === 2) { // "C:\folder" -> "C:"
      if (norm.includes(':')) {
        return norm.split(':')[0] + ':';
      }
      return '';
    }
    return norm.substring(0, lastSlash);
  }

  // Physical writing helper tasks run in the background to avoid blocking VFS UI
  private async writeRealFilePhysically(driveId: string, parentPath: string, fileName: string, content: string): Promise<void> {
    const rootHandle = this.mountedHandles[driveId];
    if (!rootHandle) return;
    try {
      const dirHandle = await this.resolvePhysicalPath(rootHandle, parentPath, true);
      const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      await this.syncRealDirectory(driveId, parentPath);
    } catch (err) {
      console.error("Physical file write error:", err);
    }
  }

  private async createRealFolderPhysically(driveId: string, parentPath: string, dirName: string): Promise<void> {
    const rootHandle = this.mountedHandles[driveId];
    if (!rootHandle) return;
    try {
      const dirHandle = await this.resolvePhysicalPath(rootHandle, parentPath, true);
      await dirHandle.getDirectoryHandle(dirName, { create: true });
      await this.syncRealDirectory(driveId, parentPath);
    } catch (err) {
      console.error("Physical folder creation error:", err);
    }
  }

  private async deleteRealItemPhysically(driveId: string, parentPath: string, name: string, isDirectory: boolean): Promise<void> {
    const rootHandle = this.mountedHandles[driveId];
    if (!rootHandle) return;
    try {
      const dirHandle = await this.resolvePhysicalPath(rootHandle, parentPath, false);
      await dirHandle.removeEntry(name, { recursive: isDirectory });
      await this.syncRealDirectory(driveId, parentPath);
    } catch (err) {
      console.error("Physical delete error:", err);
    }
  }

  private async renameRealItemPhysically(driveId: string, parentPath: string, oldName: string, newName: string, isDirectory: boolean): Promise<void> {
    const rootHandle = this.mountedHandles[driveId];
    if (!rootHandle) return;
    try {
      const dirHandle = await this.resolvePhysicalPath(rootHandle, parentPath, false);
      if (isDirectory) {
        const itemHandle = await dirHandle.getDirectoryHandle(oldName);
        if (typeof (itemHandle as any).move === 'function') {
          await (itemHandle as any).move(newName);
        } else {
          log.warn("Direct directory rename is not supported natively by this browser. Syncing back.");
        }
      } else {
        const itemHandle = await dirHandle.getFileHandle(oldName);
        if (typeof (itemHandle as any).move === 'function') {
          await (itemHandle as any).move(newName);
        } else {
          // Alternative copy-and-delete fallback
          const file = await (itemHandle as any).getFile();
          const content = await file.text();
          const newFileHandle = await dirHandle.getFileHandle(newName, { create: true });
          const writable = await newFileHandle.createWritable();
          await writable.write(content);
          await writable.close();
          await dirHandle.removeEntry(oldName);
        }
      }
      await this.syncRealDirectory(driveId, parentPath);
    } catch (err) {
      console.error("Physical rename error:", err);
    }
  }

  public createDirectory(driveId: string, parentPath: string, dirName: string): FileItem {
    const cleanName = dirName.replace(/[\\/:*?"<>|]/g, '').trim();
    if (!cleanName) throw new Error('Invalid directory name');

    const normParent = this.normalizePath(parentPath);
    const existing = this.files.find(
      f => f.driveId === driveId && this.normalizePath(f.path) === normParent && f.name.toUpperCase() === cleanName.toUpperCase() && f.isDirectory
    );
    if (existing) {
      throw new Error(`Directory ${cleanName} already exists`);
    }

    const drive = this.getDrive(driveId);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const newItem: FileItem = {
      id: `dir_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: cleanName,
      ext: '',
      path: normParent,
      driveId,
      isDirectory: true,
      size: 0,
      modifiedAt: now,
      createdAt: now,
      attributes: { readOnly: false, hidden: false, system: false, archive: false },
      isCloud: drive?.type === 'cloud',
      cloudProvider: drive?.cloudProvider,
      cloudSyncStatus: drive?.type === 'cloud' ? 'synced' : undefined
    };

    this.files.push(newItem);

    // Physical FileSystem write-through
    if (this.mountedHandles[driveId]) {
      this.createRealFolderPhysically(driveId, parentPath, cleanName);
    }

    this.saveToStorage();
    return newItem;
  }

  public createFile(driveId: string, parentPath: string, fileName: string, content: string = ''): FileItem {
    const cleanName = fileName.trim();
    if (!cleanName) throw new Error('Invalid file name');

    const parts = cleanName.split('.');
    const ext = parts.length > 1 ? parts.pop()!.toUpperCase() : '';
    const name = parts.join('.');

    const normParent = this.normalizePath(parentPath);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const drive = this.getDrive(driveId);

    const newItem: FileItem = {
      id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name,
      ext,
      path: normParent,
      driveId,
      isDirectory: false,
      size: new Blob([content]).size,
      modifiedAt: now,
      createdAt: now,
      attributes: { readOnly: false, hidden: false, system: false, archive: true },
      content,
      isCloud: drive?.type === 'cloud',
      cloudProvider: drive?.cloudProvider,
      cloudSyncStatus: drive?.type === 'cloud' ? 'synced' : undefined
    };

    this.files.push(newItem);

    // Physical FileSystem write-through
    if (this.mountedHandles[driveId]) {
      this.writeRealFilePhysically(driveId, parentPath, cleanName, content);
    }

    this.saveToStorage();
    return newItem;
  }

  public saveFileContent(fileId: string, content: string) {
    const file = this.files.find(f => f.id === fileId);
    if (!file) throw new Error('File not found');
    
    file.content = content;
    file.size = new Blob([content]).size;
    file.modifiedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
    file.attributes.archive = true;
    if (file.isCloud) {
      file.cloudSyncStatus = 'synced';
    }

    // Physical FileSystem write-through
    if (this.mountedHandles[file.driveId]) {
      const fileName = file.ext ? `${file.name}.${file.ext}` : file.name;
      this.writeRealFilePhysically(file.driveId, file.path, fileName, content);
    }

    this.saveToStorage();
  }

  public renameItem(fileId: string, newFullName: string) {
    const file = this.files.find(f => f.id === fileId);
    if (!file) throw new Error('Item not found');

    const clean = newFullName.trim();
    if (!clean) throw new Error('Invalid name');

    const oldFullName = file.ext ? `${file.name}.${file.ext}` : file.name;

    if (file.isDirectory) {
      const oldDirPath = `${this.normalizePath(file.path)}\\${file.name}`;
      const newDirPath = `${this.normalizePath(file.path)}\\${clean}`;

      // Update all descendants
      this.files.forEach(f => {
        if (f.driveId === file.driveId && f.path.startsWith(oldDirPath)) {
          f.path = f.path.replace(oldDirPath, newDirPath);
        }
      });

      file.name = clean;
      file.ext = '';
    } else {
      const parts = clean.split('.');
      const ext = parts.length > 1 ? parts.pop()!.toUpperCase() : '';
      const name = parts.join('.');
      file.name = name;
      file.ext = ext;
    }

    file.modifiedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // Physical FileSystem write-through
    if (this.mountedHandles[file.driveId]) {
      this.renameRealItemPhysically(file.driveId, file.path, oldFullName, clean, file.isDirectory);
    }

    this.saveToStorage();
  }

  public deleteItem(fileId: string, useRecycleBin: boolean = false) {
    const file = this.files.find(f => f.id === fileId);
    if (!file) return;

    if (useRecycleBin) {
      this.moveToRecycleBin(fileId);
      return;
    }

    const oldFullName = file.ext ? `${file.name}.${file.ext}` : file.name;

    if (file.isDirectory) {
      const dirPath = `${this.normalizePath(file.path)}\\${file.name}`;
      // Remove all children recursively
      this.files = this.files.filter(f => !(f.driveId === file.driveId && (f.path === dirPath || f.path.startsWith(`${dirPath}\\`))));
    }

    this.files = this.files.filter(f => f.id !== fileId);

    // Physical FileSystem write-through
    if (this.mountedHandles[file.driveId]) {
      this.deleteRealItemPhysically(file.driveId, file.path, oldFullName, file.isDirectory);
    }

    this.saveToStorage();
  }

  public moveToRecycleBin(fileId: string): boolean {
    const file = this.files.find(f => f.id === fileId);
    if (!file) return false;

    const binItem: RecycleBinItem = {
      id: `trash_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      originalId: file.id,
      originalPath: file.path,
      originalDriveId: file.driveId,
      deletedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      item: { ...file }
    };

    this.recycleBin.unshift(binItem);

    // Also add to TR: drive root virtual listing for seamless browsing
    file.driveId = 'drive_trash';
    file.path = 'TR:';

    if (file.isDirectory) {
      const dirPath = `${this.normalizePath(binItem.originalPath)}\\${file.name}`;
      this.files.forEach(f => {
        if (f.driveId === binItem.originalDriveId && (f.path === dirPath || f.path.startsWith(`${dirPath}\\`))) {
          f.driveId = 'drive_trash';
          f.path = f.path.replace(binItem.originalDriveId, 'drive_trash');
        }
      });
    }

    this.saveToStorage();
    return true;
  }

  public restoreFromRecycleBin(recycleBinItemId: string): boolean {
    const binIndex = this.recycleBin.findIndex(b => b.id === recycleBinItemId);
    if (binIndex === -1) return false;

    const binItem = this.recycleBin[binIndex];
    const file = this.files.find(f => f.id === binItem.originalId);

    if (file) {
      file.driveId = binItem.originalDriveId;
      file.path = binItem.originalPath;

      if (file.isDirectory) {
        this.files.forEach(f => {
          if (f.driveId === 'drive_trash') {
            f.driveId = binItem.originalDriveId;
          }
        });
      }
    } else {
      // Re-create if somehow unlisted
      this.files.push({
        ...binItem.item,
        driveId: binItem.originalDriveId,
        path: binItem.originalPath
      });
    }

    this.recycleBin.splice(binIndex, 1);
    this.saveToStorage();
    return true;
  }

  public emptyRecycleBin() {
    this.files = this.files.filter(f => f.driveId !== 'drive_trash');
    this.recycleBin = [];
    this.saveToStorage();
  }

  public getRecycleBinItems(): RecycleBinItem[] {
    return [...this.recycleBin];
  }

  public deletePermanentlyFromRecycleBin(recycleBinItemId: string) {
    const binIndex = this.recycleBin.findIndex(b => b.id === recycleBinItemId);
    if (binIndex === -1) return;

    const binItem = this.recycleBin[binIndex];
    this.files = this.files.filter(f => f.id !== binItem.originalId && f.driveId !== 'drive_trash');
    this.recycleBin.splice(binIndex, 1);
    this.saveToStorage();
  }

  public async copyItem(
    fileId: string,
    targetDriveId: string,
    targetPath: string,
    overwrite: boolean = true,
    onProgress?: (transferred: number, total: number) => void
  ): Promise<FileItem | undefined> {
    const file = this.files.find(f => f.id === fileId);
    if (!file) return undefined;

    const normTarget = this.normalizePath(targetPath);
    const targetDrive = this.getDrive(targetDriveId);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (file.isDirectory) {
      const oldDirPath = `${this.normalizePath(file.path)}\\${file.name}`;
      const newDirPath = `${normTarget}\\${file.name}`;

      // Collect children BEFORE pushing new items (fixes race condition)
      const children = this.files.filter(f => f.driveId === file.driveId && (f.path === oldDirPath || f.path.startsWith(`${oldDirPath}\\`)));

      // Create target directory
      const newDir: FileItem = {
        ...file,
        id: `dir_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        driveId: targetDriveId,
        path: normTarget,
        createdAt: now,
        modifiedAt: now,
        isCloud: targetDrive?.type === 'cloud',
        cloudProvider: targetDrive?.cloudProvider,
        cloudSyncStatus: targetDrive?.type === 'cloud' ? 'synced' : undefined
      };
      this.files.push(newDir);

      let transferred = 0;
      const total = children.filter(c => !c.isDirectory).reduce((s, c) => s + (c.size || 0), 0);

      // Copy all children
      for (const child of children) {
        const relativeChildPath = child.path.substring(oldDirPath.length);
        const childTargetPath = `${newDirPath}${relativeChildPath}`;
        const newChild: FileItem = {
          ...child,
          id: `copy_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          driveId: targetDriveId,
          path: childTargetPath,
          createdAt: now,
          modifiedAt: now,
          isCloud: targetDrive?.type === 'cloud',
          cloudProvider: targetDrive?.cloudProvider,
          cloudSyncStatus: targetDrive?.type === 'cloud' ? 'synced' : undefined
        };
        this.files.push(newChild);
        transferred += child.size || 0;
        if (onProgress) onProgress(transferred, total);
      }

      this.saveToStorage();
      return newDir;
    } else {
      // Check existing in target
      const existing = this.files.find(f => f.driveId === targetDriveId && this.normalizePath(f.path) === normTarget && f.name === file.name && f.ext === file.ext);
      if (existing) {
        if (overwrite) {
          existing.content = file.content;
          existing.size = file.size;
          existing.modifiedAt = now;
          this.saveToStorage();
          if (onProgress) onProgress(file.size || 0, file.size || 0);
          return existing;
        } else {
          // make unique name
          const newName = `${file.name}_Copy`;
          const newFile: FileItem = {
            ...file,
            id: `copy_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            driveId: targetDriveId,
            path: normTarget,
            name: newName,
            createdAt: now,
            modifiedAt: now,
            isCloud: targetDrive?.type === 'cloud',
            cloudProvider: targetDrive?.cloudProvider,
            cloudSyncStatus: targetDrive?.type === 'cloud' ? 'synced' : undefined
          };
          this.files.push(newFile);
          this.saveToStorage();
          if (onProgress) onProgress(file.size || 0, file.size || 0);
          return newFile;
        }
      } else {
        const newFile: FileItem = {
          ...file,
          id: `copy_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          driveId: targetDriveId,
          path: normTarget,
          createdAt: now,
          modifiedAt: now,
          isCloud: targetDrive?.type === 'cloud',
          cloudProvider: targetDrive?.cloudProvider,
          cloudSyncStatus: targetDrive?.type === 'cloud' ? 'synced' : undefined
        };
        this.files.push(newFile);
        this.saveToStorage();
        if (onProgress) onProgress(file.size || 0, file.size || 0);
        return newFile;
      }
    }
  }

  public async moveItem(fileId: string, targetDriveId: string, targetPath: string, onProgress?: (transferred: number, total: number) => void): Promise<boolean> {
    const file = this.files.find(f => f.id === fileId);
    if (!file) return false;

    const normTarget = this.normalizePath(targetPath);
    const targetDrive = this.getDrive(targetDriveId);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (file.isDirectory) {
      const oldDirPath = `${this.normalizePath(file.path)}\\${file.name}`;
      const newDirPath = `${normTarget}\\${file.name}`;

      // Collect children BEFORE modifying (fixes race condition)
      const children = this.files.filter(f => f.driveId === file.driveId && (f.path === oldDirPath || f.path.startsWith(`${oldDirPath}\\`)));

      // Update children
      for (const f of children) {
        const relativeChildPath = f.path.substring(oldDirPath.length);
        f.path = `${newDirPath}${relativeChildPath}`;
        f.driveId = targetDriveId;
      }

      file.path = normTarget;
      file.driveId = targetDriveId;
      file.modifiedAt = now;
      file.isCloud = targetDrive?.type === 'cloud';
      file.cloudProvider = targetDrive?.cloudProvider;
    } else {
      file.path = normTarget;
      file.driveId = targetDriveId;
      file.modifiedAt = now;
      file.isCloud = targetDrive?.type === 'cloud';
      file.cloudProvider = targetDrive?.cloudProvider;
    }

    this.saveToStorage();
    if (onProgress) onProgress(1, 1);
    return true;
  }

  // Cryptographic Hash Calculator (MD5 approximation + real Web Crypto SHA-1 & SHA-256)
  public async calculateFileHashes(file: FileItem): Promise<{ md5: string; sha1: string; sha256: string }> {
    return calculateFileHashesImpl(file);
  }

  // Create real ZIP file
  public async createZipArchive(items: FileItem[], archiveName: string, targetDriveId: string, targetPath: string): Promise<FileItem> {
    const zip = new JSZip();

    for (const item of items) {
      if (item.isDirectory) {
        const folderZip = zip.folder(item.name);
        const dirPath = `${this.normalizePath(item.path)}\\${item.name}`;
        const children = this.files.filter(f => f.driveId === item.driveId && (f.path === dirPath || f.path.startsWith(`${dirPath}\\`)));
        children.forEach(c => {
          if (!c.isDirectory) {
            const rel = c.path.substring(dirPath.length).replace(/\\/g, '/');
            const fullRel = rel ? `${rel}/${c.name}.${c.ext}` : `${c.name}.${c.ext}`;
            folderZip?.file(fullRel.replace(/^\//, ''), c.content || '');
          }
        });
      } else {
        const fullName = item.ext ? `${item.name}.${item.ext}` : item.name;
        zip.file(fullName, item.content || `Binary data of ${fullName}`);
      }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipBase64 = await zip.generateAsync({ type: 'base64' });
    
    let cleanArchive = archiveName.trim();
    if (!cleanArchive.toUpperCase().endsWith('.ZIP')) {
      cleanArchive += '.ZIP';
    }

    const parts = cleanArchive.split('.');
    const ext = parts.pop() || 'ZIP';
    const name = parts.join('.');
    const normTarget = this.normalizePath(targetPath);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const zipFile: FileItem = {
      id: `zip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name,
      ext,
      path: normTarget,
      driveId: targetDriveId,
      isDirectory: false,
      size: zipBlob.size,
      modifiedAt: now,
      createdAt: now,
      attributes: { readOnly: false, hidden: false, system: false, archive: true },
      content: zipBase64,
      mimeType: 'application/zip'
    };

    this.files.push(zipFile);
    this.saveToStorage();
    return zipFile;
  }

  // Extract ZIP archive
  public async extractZipArchive(zipFile: FileItem, targetDriveId: string, targetPath: string): Promise<number> {
    const zip = new JSZip();
    const zipData = zipFile.content || '';
    
    let extractedCount = 0;
    try {
      const loaded = await zip.loadAsync(zipData, { base64: true });
      const normTarget = this.normalizePath(targetPath);

      for (const [filename, fileObj] of Object.entries(loaded.files)) {
        if (fileObj.dir) {
          const dirName = filename.replace(/\/$/, '').split('/').pop() || 'Folder';
          this.createDirectory(targetDriveId, normTarget, dirName);
        } else {
          const content = await fileObj.async('text');
          const cleanName = filename.split('/').pop() || 'file.txt';
          this.createFile(targetDriveId, normTarget, cleanName, content);
          extractedCount++;
        }
      }
    } catch {
      // In case content wasn't raw base64, create an extracted demo directory
      this.createDirectory(targetDriveId, targetPath, `${zipFile.name}_extracted`);
      this.createFile(targetDriveId, `${targetPath}\\${zipFile.name}_extracted`, 'manifest.txt', `Extracted archive ${zipFile.name}.${zipFile.ext}`);
      extractedCount = 1;
    }

    this.saveToStorage();
    return extractedCount;
  }

  // Real Local Host Directory Mount (File System Access API)
  public async mountLocalDirectory(dirHandle: any, targetDriveId: string = 'drive_host'): Promise<Drive> {
    const drive = this.getDrive(targetDriveId);
    const letter = drive?.letter || 'Z:';

    const hostDrive: Drive = {
      id: targetDriveId,
      letter,
      name: tGlobal('fsHostDriveName').replace('{name}', dirHandle.name || tGlobal('fsLocalFolder')),
      type: 'host_fs',
      driveKind: 'removable',
      fileSystem: 'Host Link (File System Access API)',
      totalBytes: 1024 * 1024 * 1024 * 1024,
      freeBytes: 500 * 1024 * 1024 * 1024,
      description: tGlobal('fsHostDriveDesc').replace('{name}', dirHandle.name),
      isMounted: true
    };

    const existingDriveIdx = this.drives.findIndex(d => d.id === targetDriveId);
    if (existingDriveIdx >= 0) {
      this.drives[existingDriveIdx] = hostDrive;
    } else {
      this.drives.push(hostDrive);
    }

    // Save handle in-memory and in IndexedDB
    this.mountedHandles[targetDriveId] = dirHandle;
    if (typeof window !== 'undefined') {
      await handleStore.set(targetDriveId, dirHandle);
    }

    // Sync directories for real
    await this.syncRealDirectory(targetDriveId, letter);

    this.saveToStorage();
    return hostDrive;
  }

  // Import external real file from browser input
  public async importBrowserFile(file: File, targetDriveId: string, targetPath: string): Promise<FileItem> {
    let content: string;
    if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|json|ts|js|tsx|jsx|css|html|xml|ini|bat|sh|sql|csv|yaml|yml)$/i)) {
      content = await file.text();
    } else {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const len = Math.min(bytes.byteLength, 100000);
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      content = btoa(binary);
    }

    return this.createFile(targetDriveId, targetPath, file.name, content);
  }

  // File Splitter (Splits file into .part001, .part002, etc.)
  public splitFile(fileId: string, chunkSizeBytes: number, targetDriveId: string, targetPath: string): FileItem[] {
    const file = this.files.find(f => f.id === fileId);
    if (!file || file.isDirectory) {
      throw new Error(tGlobal('fsSplitNoFile'));
    }

    const content = file.content || '';
    const totalSize = file.size || content.length || 1;
    const numChunks = Math.max(1, Math.ceil(totalSize / chunkSizeBytes));
    const createdParts: FileItem[] = [];

    const normTarget = this.normalizePath(targetPath);
    const baseName = `${file.name}${file.ext ? '.' + file.ext : ''}`;

    for (let i = 1; i <= numChunks; i++) {
      const extNum = i.toString().padStart(3, '0');
      const chunkName = `${baseName}.part${extNum}`;
      
      const chunkLen = Math.ceil(content.length / numChunks);
      const start = (i - 1) * chunkLen;
      const chunkContent = content.substring(start, start + chunkLen);
      const chunkSize = Math.min(chunkSizeBytes, Math.max(1, Math.ceil(totalSize / numChunks)));

      const created = this.createFile(targetDriveId, normTarget, chunkName, chunkContent);
      created.size = chunkSize;
      createdParts.push(created);
    }

    this.saveToStorage();
    return createdParts;
  }

  // File Joiner (Joins .part001, .part002, etc. into reconstructed file)
  public joinFiles(firstChunkId: string, targetDriveId: string, targetPath: string): FileItem {
    const firstChunk = this.files.find(f => f.id === firstChunkId);
    if (!firstChunk) {
      throw new Error(tGlobal('fsJoinNoPart'));
    }

    const fullName = `${firstChunk.name}${firstChunk.ext ? '.' + firstChunk.ext : ''}`;
    const match = fullName.match(/^(.*)\.part(\d+)$/i);
    if (!match) {
      throw new Error(tGlobal('fsJoinBadExt'));
    }

    const originalFullName = match[1];
    const normPath = firstChunk.path;

    const allChunks = this.files
      .filter(f => f.path === normPath && `${f.name}${f.ext ? '.' + f.ext : ''}`.startsWith(`${originalFullName}.part`))
      .sort((a, b) => {
        const nameA = `${a.name}${a.ext ? '.' + a.ext : ''}`;
        const nameB = `${b.name}${b.ext ? '.' + b.ext : ''}`;
        return nameA.localeCompare(nameB);
      });

    let mergedContent = '';
    let mergedSize = 0;

    allChunks.forEach(chunk => {
      mergedContent += chunk.content || '';
      mergedSize += chunk.size;
    });

    const normTarget = this.normalizePath(targetPath);
    const joinedFile = this.createFile(targetDriveId, normTarget, originalFullName, mergedContent);
    joinedFile.size = mergedSize;

    this.saveToStorage();
    return joinedFile;
  }

  // Reset to factory defaults
  public resetToDefaults() {
    this.drives = [...initialDrives];
    this.files = [...initialFiles];
    this.saveToStorage();
  }
}

export const fsEngine = new FileSystemEngine();
