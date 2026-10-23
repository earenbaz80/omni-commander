export interface FileItem {
  id: string;
  name: string;
  ext: string;
  /**
   * Exact on-disk entry name (e.g. "Python 3.11", "archive.tar.gz").
   * `name`/`ext` are display-only splits, so this is the authority for any
   * operation that must address the real file.
   */
  fullName?: string;
  path: string; // e.g. "C:\WINDOWS\SYSTEM32"
  driveId: string;
  isDirectory: boolean;
  size: number; // in bytes
  modifiedAt: string; // ISO or formatted date
  createdAt: string;
  attributes: {
    readOnly: boolean;
    hidden: boolean;
    system: boolean;
    archive: boolean;
  };
  content?: string; // Text content or base64 data
  mimeType?: string;
  icon?: string;
  isLocked?: boolean;
}

export type DriveType = 'local' | 'usb' | 'network' | 'ram' | 'host_fs';

export interface Drive {
  id: string;
  letter: string; // "C:", "D:", "GD:", "Z:"
  name: string;
  type: DriveType;
  totalBytes: number;
  freeBytes: number;
  icon?: string;
  isMounted: boolean;
  readOnly?: boolean;
  description?: string;
  // Far-like real filesystem detection metadata
  driveKind?: 'fixed' | 'removable' | 'network' | 'optical' | 'ram' | 'unknown';
  fileSystem?: string;
  serialNumber?: string;
}

export type ViewMode = 'full' | 'brief' | 'thumbnails' | 'tree' | 'gallery';
export type SortField = 'name' | 'ext' | 'size' | 'modifiedAt';
export type SortDirection = 'asc' | 'desc';

export interface PanelTab {
  id: string;
  title: string;
  driveId: string;
  currentPath: string;
  history: string[];
  historyIndex: number;
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  filterText: string;
  selectedIds: string[];
  focusedIndex: number;
  isLocked?: boolean;
}

export interface PanelState {
  id: 'left' | 'right';
  activeTabId: string;
  tabs: PanelTab[];
  isTreeVisible: boolean;
  isQuickView: boolean;
}

export type ThemeId =
  | 'classic_blue'
  | 'norton_classic'
  | 'midnight_amber'
  | 'matrix_green'
  | 'windows11_dark'
  | 'windows11_light'
  | 'retro_gray'
  | 'total_commander'
  | 'dracula_retro'
  | 'solarized_dark';

export type LanguageCode = 'es' | 'en' | 'de' | 'fr' | 'pt' | 'it' | 'ru' | 'ja';

export type KeybindingPreset = 'norton' | 'totalcmd' | 'midnight' | 'custom';

export interface BookmarkItem {
  id: string;
  title: string;
  path: string;
  driveId: string;
  icon?: string;
  isFavorite?: boolean;
}

export interface RecycleBinItem {
  id: string;
  originalId: string;
  originalPath: string;
  originalDriveId: string;
  deletedAt: string;
  item: FileItem;
}

/** One file inside a running transfer, as reported by the transfer engine. */
export interface FileProgressEntry {
  /** Destination path, used as the identity of the row. */
  path: string;
  /** Display name of the destination entry. */
  name: string;
  size: number;
  copied: number;
  status: 'copying' | 'done' | 'skipped' | 'error';
}

export interface BackgroundTask {
  id: string;
  type: 'copy' | 'move' | 'delete' | 'archive' | 'extract' | 'sync' | 'checksum';
  title: string;
  details?: string;
  progress: number; // 0 to 100
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  speed?: string;
  transferredBytes?: number;
  totalBytes?: number;
  createdAt: string;
  error?: string;
  /** Seconds remaining, as reported by the transfer engine. */
  etaSeconds?: number;
  /** File currently being written, shown as progress detail. */
  currentFile?: string;
  /** Bytes written for the current file, for a per-file progress bar. */
  currentFileBytes?: number;
  /** Total bytes of the current file, for a per-file progress bar. */
  currentFileTotal?: number;
  /** Tail of the files this task touched, for per-file progress rows. */
  files?: FileProgressEntry[];
  /** What this task transfers, kept so the copy list can be saved and re-run. */
  plan?: TransferPlan;
  /** Server-side job this task drives, needed to retune it while it runs. */
  serverJobId?: string;
  /** Speed limit in bytes per second currently applied to the server job. 0 means unlimited. */
  throttleBps?: number;
}

/** One queued source of a transfer plan, addressed by its real absolute path. */
export interface TransferPlanEntry {
  /** Absolute source path on disk. */
  path: string;
  /** Entry name, shown in per-file rows. */
  name: string;
  isDirectory: boolean;
  size: number;
}

/**
 * A transfer as planned, which is what a saved copy list is made of: enough to
 * queue the same batch again in a later session, without the in-memory catalogue.
 */
export interface TransferPlan {
  op: 'copy' | 'move';
  sourceDriveId: string;
  targetDriveId: string;
  targetDir: string;
  overwrite: boolean;
  collision: CollisionPolicy;
  throttleBps: number;
  entries: TransferPlanEntry[];
}

/** What to do when the destination entry already exists. 'ask' prompts per entry. */
export type CollisionPolicy = 'overwrite' | 'skip' | 'rename' | 'ask' | 'cancel' | 'overwrite-if-different' | 'rename-old' | 'resume';

/** Answer given to a single collision prompt raised by the transfer engine. */
export type ConflictResolution = 'overwrite' | 'skip' | 'rename' | 'overwrite-if-different' | 'rename-old' | 'resume' | 'cancel';

/** A destination the running transfer cannot resolve without a human answer. */
export interface PendingConflict {
  jobId: string;
  source: string;
  destination: string;
  /** Name of the destination entry, shown in the prompt headline. */
  name: string;
  /** Bytes on each side, measured by the server when the conflict was raised. */
  sourceSize?: number;
  destinationSize?: number;
  /** Last-write time in epoch milliseconds, for the same comparison. */
  sourceModified?: number;
  destinationModified?: number;
  isDirectory?: boolean;
  /** Same size and same timestamp, so overwriting would change nothing. */
  identical?: boolean;
}

/** User-chosen knobs for a real copy/move operation. */
export interface TransferOptions {
  collision: CollisionPolicy;
  /** Transfer cap in bytes per second; 0 means unlimited. */
  throttleBps: number;
  /**
   * Set only when the user accepted a shortfall in the free-space prompt. It
   * relaxes the server's own space guard; the disk still has the final word.
   */
  force?: boolean;
}

/** Free space on one volume for the bytes a pending transfer needs there. */
export interface FreeSpaceVolume {
  /** Volume root, e.g. `D:\`. */
  volume: string;
  /** Bytes the queued sources will occupy, measured by the server. */
  size: number;
  /** Available bytes on the volume, or null when it could not be read. */
  free: number | null;
  /** Bytes missing to fit, 0 when the transfer fits or cannot be judged. */
  lacking: number;
}

export interface FreeSpaceReport {
  volumes: FreeSpaceVolume[];
}

export interface UserSettings {
  theme: ThemeId;
  language: LanguageCode;
  showHiddenFiles: boolean;
  showSystemFiles: boolean;
  showToolbar: boolean;
  confirmDelete: boolean;
  confirmCopyOverwrite: boolean;
  retroDosBorders: boolean;
  soundEffects: boolean;
  fontSize: 'compact' | 'normal' | 'large';
  fontFamily: 'mono' | 'dos' | 'sans';
  splitLayout: 'horizontal' | 'vertical';
  dualPaneRatio: number; // 50% default
  quickPreviewAutoPlay: boolean;
  showCommandLine: boolean;
  showFunctionBar: boolean;
  showDriveButtons: boolean;
  showHoverTooltips: boolean;
  showImageHoverThumbnails: boolean;
  showCollapsibleInfoDrawer: boolean;
  showClock: boolean;
  clockPosition: 'header' | 'footer' | 'both';
  crtEffectEnabled: boolean;
  crtIntensity: 'subtle' | 'classic' | 'intense';
  blinkingCursorEnabled: boolean;
  cursorBlinkColor?: 'amber' | 'cyan' | 'green' | 'red' | 'white';
  fileSelectorColor?: 'blue' | 'amber' | 'cyan' | 'green' | 'red' | 'purple';
  authorName: string;
  // Security & Password Protection
  appLockEnabled: boolean;
  appUsername: string;
  appPasswordHash: string; // PBKDF2-SHA256 hash (base64). Legacy plaintext when no salt is set.
  appPasswordSalt?: string; // Per-app random salt (base64) for appPasswordHash
  protectedFolders: Record<string, string>; // path -> password
  customShortcuts: Record<string, string>;
  keybindingPreset: KeybindingPreset;
  useRecycleBin: boolean;
}

export interface ClipboardState {
  items: FileItem[];
  operation: 'copy' | 'cut';
  sourceDriveId: string;
  sourcePath: string;
}

export interface FileOperationProgress {
  type: 'copy' | 'move' | 'delete' | 'zip' | 'unzip' | 'search';
  title: string;
  currentItem: string;
  current: number;
  total: number;
  percentage: number;
  isRunning: boolean;
  bytesTransferred?: number;
  totalBytes?: number;
  error?: string;
}

export type ActiveModal =
  | null
  | 'help'
  | 'about'
  | 'user_menu'
  | 'userMenu'
  | 'viewer'
  | 'editor'
  | 'copy'
  | 'move'
  | 'mkdir'
  | 'delete'
  | 'quit'
  | 'batch_rename'
  | 'batchRename'
  | 'diff_compare'
  | 'diffCompare'
  | 'search_grep'
  | 'searchGrep'
  | 'checksum'
  | 'properties'
  | 'zip_archive'
  | 'zipArchive'
  | 'disk_usage'
  | 'diskUsage'
  | 'settings'
  | 'new_file'
  | 'shortcuts_cheat'
  | 'protect_folder'
  | 'unlock_folder'
  | 'app_lock'
  | 'sync_folders'
  | 'syncFolders'
  | 'ftp_manager'
  | 'ftpManager'
  | 'file_splitter'
  | 'fileSplitter'
  | 'file_joiner'
  | 'fileJoiner'
  | 'cmd_winget_library'
  | 'cmdWingetLibrary'
  | 'recycle_bin'
  | 'recycleBin'
  | 'hotlist_bookmarks'
  | 'hotlistBookmarks'
  | 'background_tasks'
  | 'backgroundTasks'
  | 'transfer_monitor';

export interface CommandHistoryItem {
  id: string;
  timestamp: string;
  command: string;
  output: string;
  status: 'ok' | 'error' | 'info';
}
