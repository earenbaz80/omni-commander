import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { FileTypeIcon, fileIconColor, fileIconKind, type FileIconKind } from './FileTypeIcon';
import { themes } from '../services/themeManager';

const item = (ext: string, isDirectory = false) => ({ ext, isDirectory });

const KINDS: FileIconKind[] = [
  'folder',
  'exec',
  'archive',
  'disk',
  'document',
  'code',
  'image',
  'audio',
  'video',
  'file',
];

describe('fileIconKind', () => {
  it('gives a directory the folder glyph whatever its extension says', () => {
    expect(fileIconKind(item('zip', true))).toBe('folder');
  });

  it('maps each family of extensions to its own glyph', () => {
    expect(fileIconKind(item('exe'))).toBe('exec');
    expect(fileIconKind(item('rar'))).toBe('archive');
    expect(fileIconKind(item('iso'))).toBe('disk');
    expect(fileIconKind(item('pdf'))).toBe('document');
    expect(fileIconKind(item('tsx'))).toBe('code');
    expect(fileIconKind(item('png'))).toBe('image');
    expect(fileIconKind(item('flac'))).toBe('audio');
    expect(fileIconKind(item('mkv'))).toBe('video');
  });

  it('falls back to the plain page for anything it does not recognise', () => {
    expect(fileIconKind(item('xyz'))).toBe('file');
    expect(fileIconKind(item(''))).toBe('file');
  });

  it('reads the extension without caring about its case', () => {
    expect(fileIconKind(item('PNG'))).toBe('image');
    expect(fileIconKind(item('7z'))).toBe('archive');
  });
});

describe('fileIconColor', () => {
  const theme = themes.retro_futurist;

  it('takes every colour from the theme instead of carrying its own', () => {
    expect(fileIconColor('folder', theme)).toBe(theme.folderText);
    expect(fileIconColor('exec', theme)).toBe(theme.exeText);
    expect(fileIconColor('archive', theme)).toBe(theme.zipText);
    expect(fileIconColor('disk', theme)).toBe(theme.zipText);
    expect(fileIconColor('document', theme)).toBe(theme.docText);
    expect(fileIconColor('code', theme)).toBe(theme.accent);
    expect(fileIconColor('image', theme)).toBe(theme.mediaText);
    expect(fileIconColor('audio', theme)).toBe(theme.mediaText);
    expect(fileIconColor('video', theme)).toBe(theme.mediaText);
    expect(fileIconColor('file', theme)).toBe(theme.itemText);
  });

  it('never hands the retro panel a pink or magenta glyph', () => {
    // Pink and magenta are the one thing this palette must not contain: a high
    // red with a high blue over a low green. Amber and cyan stay clear of it.
    for (const kind of KINDS) {
      const hex = fileIconColor(kind, theme);
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      expect(r > 200 && b > 160 && g < 140).toBe(false);
    }
  });
});

describe('FileTypeIcon', () => {
  it('paints the glyph with the colour it is handed and stays out of the a11y tree', () => {
    const { container } = render(<FileTypeIcon kind="archive" color="#ffb347" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('stroke')).toBe('#ffb347');
    expect(svg.getAttribute('data-file-icon')).toBe('archive');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('fills the folder body with that same colour, so it needs no second hue', () => {
    const { container } = render(<FileTypeIcon kind="folder" color="#6ec8e8" />);
    const filled = Array.from(container.querySelectorAll('path[fill]'));
    expect(filled.length).toBeGreaterThan(0);
    for (const path of filled) expect(path.getAttribute('fill')).toBe('#6ec8e8');
  });

  it('draws every kind on the same 16 px grid', () => {
    for (const kind of KINDS) {
      const { container, unmount } = render(<FileTypeIcon kind={kind} color="#ffffff" />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
      expect(svg.children.length).toBeGreaterThan(0);
      unmount();
    }
  });
});
