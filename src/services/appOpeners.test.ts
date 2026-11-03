import { describe, it, expect } from 'vitest';
import { FileItem } from '../types';
import { appTargetsFor, consoleCommandFor, isTextItem } from './appOpeners';

const base: FileItem = {
  id: 'x',
  name: 'archivo',
  ext: '',
  fullName: 'archivo',
  isDirectory: false,
  size: 1,
  path: 'C:\\datos',
  driveId: 'real_C',
  modifiedAt: '2026-01-01 10:00',
  createdAt: '2026-01-01 10:00',
  attributes: { readOnly: false, hidden: false, system: false, archive: true },
  content: '',
};

const withExt = (ext: string, name = 'archivo'): FileItem => ({
  ...base,
  ext,
  name,
  fullName: ext ? `${name}.${ext.toLowerCase()}` : name,
});

describe('in-app open targets', () => {
  it('offers the image studio for pictures', () => {
    expect(appTargetsFor(withExt('PNG', 'foto'))).toEqual(['image', 'terminal']);
    expect(appTargetsFor(withExt('JPG', 'foto'))).toEqual(['image', 'terminal']);
  });

  it('offers the player for audio and video, never the image studio', () => {
    expect(appTargetsFor(withExt('MP3', 'tema'))).toEqual(['media', 'terminal']);
    expect(appTargetsFor(withExt('MP4', 'clip'))).toEqual(['media', 'terminal']);
    expect(appTargetsFor(withExt('MP3', 'tema'))).not.toContain('image');
  });

  it('offers the text editor for text-like files only', () => {
    expect(appTargetsFor(withExt('TXT', 'notas'))).toEqual(['text', 'terminal']);
    expect(isTextItem(withExt('md', 'LEEME'))).toBe(true);
    expect(isTextItem(withExt('EXE', 'setup'))).toBe(false);
    // A binary is still reachable from the console, just not from the editor.
    expect(appTargetsFor(withExt('EXE', 'setup'))).toEqual(['terminal']);
  });

  it('offers nothing for a folder', () => {
    expect(appTargetsFor({ ...base, isDirectory: true })).toEqual([]);
    expect(appTargetsFor(null)).toEqual([]);
  });

  it('quotes the console command so names with spaces stay one argument', () => {
    expect(consoleCommandFor(withExt('TXT', 'mi nota'))).toBe('type "mi nota.txt"');
    expect(consoleCommandFor({ ...base, ext: '', name: 'hosts', fullName: 'hosts' })).toBe('type "hosts"');
  });
});
