import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { useFileContent } from './useFileContent';
import { fsEngine } from '../services/fileSystem';
import { MAX_TEXT_FILE_BYTES } from '../utils/fileContent';
import { FileItem } from '../types';

/** A real-drive entry: the listing fills name, size and date, never content. */
const realFile: FileItem = {
  id: 'f1',
  name: 'notas',
  ext: 'TXT',
  fullName: 'notas.txt',
  path: 'C:\\Temp',
  driveId: 'real_C',
  isDirectory: false,
  size: 12,
  modifiedAt: '2026-10-20 10:00',
  createdAt: '2026-10-20 10:00',
  attributes: { readOnly: false, hidden: false, system: false, archive: true },
};

const bytesOf = (text: string) => new TextEncoder().encode(text);

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('useFileContent', () => {
  it('reads just past the cap, so a larger file is noticed', async () => {
    const spy = vi.spyOn(fsEngine, 'readFileBytes').mockResolvedValue(bytesOf('hola'));
    const { result } = renderHook(() => useFileContent(realFile));

    expect(result.current.state.status).toBe('loading');
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    expect(spy).toHaveBeenCalledWith(realFile, { maxBytes: MAX_TEXT_FILE_BYTES + 1 });
    expect(result.current.state).toMatchObject({ text: 'hola', binary: false, truncated: false });
  });

  it('surfaces the reason instead of handing back empty content', async () => {
    vi.spyOn(fsEngine, 'readFileBytes').mockRejectedValue(new Error('EBUSY'));

    const { result } = renderHook(() => useFileContent(realFile));

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toEqual({ status: 'error', message: 'EBUSY' });
  });

  it('reads the file again when asked to reload', async () => {
    const spy = vi
      .spyOn(fsEngine, 'readFileBytes')
      .mockResolvedValueOnce(bytesOf('primera'))
      .mockResolvedValueOnce(bytesOf('segunda'));
    const { result } = renderHook(() => useFileContent(realFile));
    await waitFor(() => expect(result.current.state).toMatchObject({ text: 'primera' }));

    act(() => result.current.reload());

    await waitFor(() => expect(result.current.state).toMatchObject({ text: 'segunda' }));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('asks the server for nothing when there is no file', () => {
    const spy = vi.spyOn(fsEngine, 'readFileBytes');

    const { result } = renderHook(() => useFileContent(null));

    expect(spy).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe('loading');
  });
});
