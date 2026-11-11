/**
 * The slice of the preload bridge this renderer actually calls.
 *
 * Every access used to be `(window as any).electronAPI`, which meant a renamed
 * or missing preload export failed at the call site with a runtime error and no
 * build ever noticed. Declaring it once keeps `window` a real Window and makes
 * the compiler check the names.
 */
export interface ElectronBridge {
  /** True only inside the packaged or development Electron renderer. */
  isElectron?: boolean;
  /** Port the embedded server actually bound; it is not assumed. */
  apiPort?: unknown;
  /** Per-launch token the server requires on mutating requests. */
  apiToken?: string;
  /** UAC restarts the process, so refusing is a normal answer rather than a throw. */
  relaunchAsAdmin?: () => Promise<ElevationResult>;
  /** Hands a URL to the shell: the app blocks navigation out of its window. */
  openExternal?: (url: string) => Promise<unknown>;
  /**
   * Native picker for paths outside the panels. Windows cannot mix files and
   * folders in one dialog, so the mode chooses; it answers absolute paths, and
   * an empty list when the dialog was cancelled.
   */
  pickPaths?: (mode: 'folders' | 'files', title?: string) => Promise<string[]>;
  minimizeWindow?: () => void;
  maximizeWindow?: () => void;
  closeWindow?: () => void;
}

/** What the main process answers to a UAC request. */
export interface ElevationResult {
  ok: boolean;
  reason?: string;
  /** Raw exit code or OS message behind a refusal, shown with the reason. */
  detail?: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronBridge;
  }
}
