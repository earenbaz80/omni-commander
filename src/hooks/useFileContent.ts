import { useCallback, useEffect, useState } from 'react';
import { FileItem } from '../types';
import { fsEngine } from '../services/fileSystem';
import { decodeFileBytes, DecodedFileContent, MAX_TEXT_FILE_BYTES } from '../utils/fileContent';

export type FileContentState =
  { status: 'loading' } | ({ status: 'ready' } & DecodedFileContent) | { status: 'error'; message: string };

/**
 * Loads the real bytes of a file for the viewer and the editor.
 *
 * Both used to paint `file.content`, a field the listing of a real drive never
 * fills — it carries name, size and date only. A real file therefore opened
 * empty, and the editor's save wrote that empty buffer back over it, truncating
 * the file. The content now comes from disk whenever the file is open, and the
 * callers refuse to save until this hook reports `ready`.
 */
export function useFileContent(file: FileItem | null): { state: FileContentState; reload: () => void } {
  const [state, setState] = useState<FileContentState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setState({ status: 'loading' });

    fsEngine
      // One byte past the cap is enough to know the file is bigger.
      .readFileBytes(file, { maxBytes: MAX_TEXT_FILE_BYTES + 1 })
      .then((bytes) => {
        if (cancelled) return;
        setState({ status: 'ready', ...decodeFileBytes(bytes, MAX_TEXT_FILE_BYTES) });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [file, attempt]);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  return { state, reload };
}
