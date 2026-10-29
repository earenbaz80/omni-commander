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
  contentEncoding?: 'utf8' | 'base64';
  archiveRoot?: string;
  archiveEntry?: string;
  mimeType?: string;
  icon?: string;
  isLocked?: boolean;
}

export type DriveType = 'local' | 'usb' | 'network' | 'ram' | 'host_fs';

/**
 * Live load of the machine the local server runs on, for the info drawer.
 * Every field is measured: there is no sensible placeholder for a CPU share.
 */
export interface SystemStats {
  /** Logical processors the percentage is averaged over. */
  cores: number;
  /** Busy share of all cores, 0-100, or null before a usable sample exists. */
  cpuPercent: number | null;
  ramUsedBytes: number;
  ramTotalBytes: number;
}

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
  // Virtual archive navigation state
  archiveRoot?: string; // Absolute path of the archive file on disk
  virtualPath?: string; // Current path inside the archive (relative to archive root)
}

export interface PanelState {
  id: 'left' | 'right';
  activeTabId: string;
  tabs: PanelTab[];
  isTreeVisible: boolean;
  isQuickView: boolean;
  /** What the panel body shows: the file list, or the TreeSize view. */
  panelView?: 'files' | 'diskUsage';
}

export type ThemeId =
  | 'classic_blue'
  | 'midnight_amber'
  | 'matrix_green'
  | 'windows11_dark'
  | 'windows11_light'
  | 'retro_gray'
  | 'dracula_retro'
  | 'solarized_dark';

export type LanguageCode = 'es' | 'en' | 'de' | 'fr' | 'pt' | 'it' | 'ru' | 'ja';

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
export type CollisionPolicy =
  'overwrite' | 'skip' | 'rename' | 'ask' | 'cancel' | 'overwrite-if-different' | 'rename-old' | 'resume';

/** Answer given to a single collision prompt raised by the transfer engine. */
export type ConflictResolution =
  'overwrite' | 'skip' | 'rename' | 'overwrite-if-different' | 'rename-old' | 'resume' | 'cancel';

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

/**
 * What a protected folder keeps: the PBKDF2 salt and derived hash, both base64.
 *
 * An empty salt marks a value saved by an older build, which stored the password
 * as it was typed. Those still open their folder -- verification falls back to a
 * plain comparison -- and are replaced by a derived record the first time the
 * password is used, so the plaintext leaves the settings as folders are opened.
 */
export interface FolderPasswordRecord {
  salt: string;
  hash: string;
}

export interface UserSettings {
  theme: ThemeId;
  language: LanguageCode;
  showHiddenFiles: boolean;
  showSystemFiles: boolean;
  showToolbar: boolean;
  /** Menus open when the pointer crosses their title, without a click. */
  menuBarHoverOpen?: boolean;
  confirmDelete: boolean;
  confirmCopyOverwrite: boolean;
  retroDosBorders: boolean;
  soundEffects: boolean;
  fontSize: 'compact' | 'normal' | 'large';
  fontFamily: 'mono' | 'dos' | 'sans';
  splitLayout: 'horizontal' | 'vertical';
  dualPaneRatio: number; // 50% default, panes side by side
  /** Same 50% default, for the stacked arrangement. Kept apart so switching layouts does not move both splits. */
  dualPaneRatioRows?: number;
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
  /** Folder path -> its password record. Never the password itself. */
  protectedFolders: Record<string, FolderPasswordRecord>;
  customShortcuts: Record<string, string>;
  useRecycleBin: boolean;
  /** Last folder a "Enviar a" copy landed in, so the picker reopens there. */
  sendToLastFolder?: string;
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

export interface DiskUsageItem {
  path: string;
  name: string;
  sizeBytes: number;
  fileCount: number;
  subFolders?: DiskUsageItem[];
}

/** A file that came out of a TreeSize scan, with the folder that holds it. */
export interface DiskUsageTopFile {
  /** Folder the file lives in. */
  path: string;
  fullName: string;
  size: number;
}

/**
 * Result of scanning a real folder on disk. Unlike `DiskUsageItem`, every size
 * here was measured, so it is worth showing even for folders never opened.
 */
export interface DiskUsageScan extends DiskUsageItem {
  dirCount: number;
  /** True when the walk could not measure everything (depth cap or unreadable folder). */
  truncated: boolean;
  subFolders?: DiskUsageScan[];
  topFiles: DiskUsageTopFile[];
}

/**
 * Live counters of a TreeSize walk. A whole drive takes minutes to measure, so
 * the scan reports as it goes instead of answering once at the end; `folders`
 * carries the root folders already finished, biggest first.
 */
export interface TreeSizeProgress {
  /** Entries seen so far: files and folders together. */
  entries: number;
  files: number;
  dirs: number;
  /** Bytes of the files measured so far. */
  bytes: number;
  /** Folder the walk is inside right now. */
  currentPath: string;
  elapsedMs: number;
  folders: DiskUsageItem[];
}

/** How a TreeSize scan reports its progress and how the caller stops it. */
export interface TreeSizeOptions {
  signal?: AbortSignal;
  onProgress?: (progress: TreeSizeProgress) => void;
}

/**
 * Why a scan produced no tree. They are kept apart because the answer is
 * different in each case: an unreachable server is retried or reported as a
 * fault, a folder closed by permissions needs administrator rights, and a
 * missing folder is simply gone.
 */
export type TreeSizeFailure = 'unreachable' | 'forbidden' | 'notFound' | 'refused';

/**
 * A finished scan, or the reason there is none. The discriminant is a string
 * because this project compiles without `strictNullChecks`, where narrowing a
 * union by a `true`/`false` field does not work and every read of the other
 * side would need a cast.
 */
export type TreeSizeResult = { status: 'ok'; tree: DiskUsageScan } | { status: 'failed'; reason: TreeSizeFailure };

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
  | 'zipPassword'
  | 'disk_usage'
  | 'diskUsage'
  | 'cleanup'
  | 'settings'
  | 'new_file'
  | 'rename'
  | 'choose_folder'
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
  | 'transfer_monitor'
  | 'archive_info'
  | 'archiveInfo';

export interface CommandHistoryItem {
  id: string;
  timestamp: string;
  command: string;
  output: string;
  status: 'ok' | 'error' | 'info';
}
