import { describe, expect, it, afterEach } from 'vitest';
import { canPickPaths, pickPathsFromDisk } from './nativePicker';
import { getTranslations } from '../i18n/translations';

/**
 * The native dialog lives in the Electron shell. In a browser build there is no
 * bridge at all, and the transfer window must quietly keep showing the list
 * instead of offering a button that cannot work.
 */

function stubBridge(pickPaths: (mode: string, title?: string) => Promise<string[]>) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = { pickPaths };
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('native path picker', () => {
  it('reports the dialog as unavailable in a browser build', async () => {
    expect(canPickPaths()).toBe(false);
    expect(await pickPathsFromDisk('files', 'en')).toEqual([]);
  });

  it('asks for files or folders with a title in the app language', async () => {
    const calls: Array<{ mode: string; title?: string }> = [];
    stubBridge(async (mode, title) => {
      calls.push({ mode, title });
      return ['C:\\a.txt'];
    });

    await pickPathsFromDisk('files', 'es');
    await pickPathsFromDisk('folders', 'es');

    expect(calls).toEqual([
      { mode: 'files', title: getTranslations('es').transferAddDialogFile },
      { mode: 'folders', title: getTranslations('es').transferAddDialogFolder }
    ]);
  });

  it('drops blank results and survives a bridge that throws', async () => {
    stubBridge(async () => ['C:\\a.txt', '', '  ']);
    expect(await pickPathsFromDisk('files', 'en')).toEqual(['C:\\a.txt']);

    stubBridge(async () => {
      throw new Error('dialog exploded');
    });
    expect(await pickPathsFromDisk('files', 'en')).toEqual([]);
  });
});
