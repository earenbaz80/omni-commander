import { FileItem } from '../types';
import { isAudioItem, isImageItem, isVideoItem } from './mediaUrl';

/**
 * Which of the app's own tools can open a file, and in what order.
 *
 * "Abrir con" used to offer only programs registered with Windows, which meant
 * the viewers and the editor this app already ships were not reachable from the
 * one menu that exists to choose how to open something. This decides what to
 * list, so the menu and any future caller agree on it.
 */
export type AppTarget = 'image' | 'media' | 'text' | 'terminal';

/**
 * Extensions the text editor opens comfortably. Binaries are left out on
 * purpose: the editor would decode them as replacement characters and saving
 * would corrupt the file.
 */
const TEXT_EXTENSIONS = new Set([
  'TXT',
  'MD',
  'MARKDOWN',
  'LOG',
  'CSV',
  'TSV',
  'JSON',
  'XML',
  'YML',
  'YAML',
  'INI',
  'CFG',
  'CONF',
  'ENV',
  'PROPERTIES',
  'JS',
  'MJS',
  'CJS',
  'JSX',
  'TS',
  'TSX',
  'CSS',
  'SCSS',
  'LESS',
  'HTML',
  'HTM',
  'SVGX',
  'C',
  'H',
  'CPP',
  'HPP',
  'CS',
  'JAVA',
  'KT',
  'SWIFT',
  'PY',
  'RB',
  'PHP',
  'GO',
  'RS',
  'SH',
  'BAT',
  'CMD',
  'PS1',
  'SQL',
  'LUA',
  'PL',
  'VUE',
  'SVELTE',
  'TOML',
  'DIFF',
  'PATCH',
]);

export function isTextItem(item: FileItem | null): boolean {
  return !!item && !item.isDirectory && TEXT_EXTENSIONS.has((item.ext || '').toUpperCase());
}

/**
 * The tools to offer for a file, most specific first. Every file can be shown
 * in the console, so `terminal` is always last.
 */
export function appTargetsFor(item: FileItem | null): AppTarget[] {
  if (!item || item.isDirectory) return [];
  const targets: AppTarget[] = [];
  if (isImageItem(item)) targets.push('image');
  if (isAudioItem(item) || isVideoItem(item)) targets.push('media');
  if (isTextItem(item)) targets.push('text');
  targets.push('terminal');
  return targets;
}

/**
 * The command that prints a file in the built-in console.
 *
 * Quoted so a name with spaces stays one argument; the console strips the
 * quotes before matching the listing. Any quote inside the name is dropped
 * rather than escaped, because a Windows file name cannot contain one anyway.
 */
export function consoleCommandFor(item: FileItem): string {
  // `fullName` is the name as it exists on disk; `name`/`ext` come from the
  // listing, where the extension is upper-cased for display.
  const name = (item.fullName || `${item.name}${item.ext ? `.${item.ext}` : ''}`).replace(/"/g, '');
  return `type "${name}"`;
}
