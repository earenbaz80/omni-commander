// @vitest-environment node
import { describe, expect, it } from 'vitest';

/**
 * The Windows libraries moved out of `fileOps` so every platform resolves its
 * own first folders. The behavior they had has to survive the move: the profile
 * answers where Desktop and Documents were redirected, a folder that is not on
 * disk is not offered, and a failed lookup falls back to the profile's names
 * instead of reporting nothing.
 */

const { createWindowsUserFolders } = require('./windowsUserFolders.cjs');

const PROFILE = String.raw`C:\Users\ana`;
const existing = (...paths: string[]) => ({ existsSync: (file: string) => paths.includes(file) });

/** PowerShell answering the redirected folders, as the profile reports them. */
const answering = (payload: Record<string, string>) => async () => ({
  stdout: JSON.stringify(payload),
});

describe('Windows user folders', () => {
  it('reports the redirected folders and the profile ones, dropping what is not there', async () => {
    const calls: string[] = [];
    const adapter = createWindowsUserFolders({
      env: { USERPROFILE: PROFILE },
      fs: existing(
        String.raw`D:\OneDrive\Escritorio`,
        String.raw`${PROFILE}\Pictures`,
        String.raw`${PROFILE}\Downloads`,
      ),
      execFileAsync: async (_file: string, args: string[]) => {
        calls.push(args.join(' '));
        return answering({
          desktop: String.raw`D:\OneDrive\Escritorio`,
          documents: String.raw`D:\OneDrive\Documentos`,
        })();
      },
    });

    await expect(adapter.list()).resolves.toEqual([
      { key: 'desktop', path: String.raw`D:\OneDrive\Escritorio` },
      { key: 'pictures', path: String.raw`${PROFILE}\Pictures` },
      { key: 'downloads', path: String.raw`${PROFILE}\Downloads` },
    ]);
    expect(calls[0]).toContain('GetFolderPath');
    expect(calls[0]).toContain('MyDocuments');
  });

  it('falls back to the profile names when the lookup fails', async () => {
    const adapter = createWindowsUserFolders({
      env: { USERPROFILE: PROFILE },
      fs: existing(String.raw`${PROFILE}\Music`, String.raw`${PROFILE}\Downloads`),
      execFileAsync: async () => {
        throw new Error('powershell is not answering');
      },
    });

    await expect(adapter.list()).resolves.toEqual([
      { key: 'music', path: String.raw`${PROFILE}\Music` },
      { key: 'downloads', path: String.raw`${PROFILE}\Downloads` },
    ]);
  });

  it('guesses nothing without an absolute profile', async () => {
    const adapter = createWindowsUserFolders({
      env: {},
      // A relative "Desktop" would resolve against wherever the server runs.
      fs: existing('Desktop', 'Documents'),
      execFileAsync: async () => {
        throw new Error('powershell is not answering');
      },
    });

    await expect(adapter.list()).resolves.toEqual([]);
  });
});
