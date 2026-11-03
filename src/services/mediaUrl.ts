import { FileItem } from '../types';
import { API_BASE } from './apiBase';
import { fsEngine } from './fileSystem';

const IMAGE_EXTENSIONS = new Set(['PNG', 'JPG', 'JPEG', 'WEBP', 'GIF', 'BMP', 'ICO', 'AVIF']);
const AUDIO_EXTENSIONS = new Set(['MP3', 'WAV', 'OGG', 'OPUS', 'M4A', 'AAC', 'FLAC', 'WMA', 'MID']);
const VIDEO_EXTENSIONS = new Set(['MP4', 'M4V', 'WEBM', 'MKV', 'AVI', 'MOV', 'WMV', 'MPG', 'MPEG']);

const extOf = (item: FileItem): string => (item.ext || '').toUpperCase();

export const isImageItem = (item: FileItem): boolean => !item.isDirectory && IMAGE_EXTENSIONS.has(extOf(item));
export const isAudioItem = (item: FileItem): boolean => !item.isDirectory && AUDIO_EXTENSIONS.has(extOf(item));
export const isVideoItem = (item: FileItem): boolean => !item.isDirectory && VIDEO_EXTENSIONS.has(extOf(item));

/**
 * URL for a file the browser can decode itself.
 *
 * The grid, the hover preview and the player all need the same thing: a source
 * an `<img>` or a `<video>` accepts. The listing of a real drive carries no
 * bytes and archive entries live in memory, so the URL points at the local
 * server, which streams the file with Range support (that is what lets a video
 * seek instead of being downloaded whole). Entries the server does not own — a
 * folder inside an archive, for instance — get no URL and keep their icon.
 *
 * The per-launch token rides in the query string because an `<img>` cannot send
 * a header; it never leaves this machine.
 */
export function mediaUrlFor(item: FileItem | null): string | null {
  if (!item) return null;
  const absolute = fsEngine.absolutePathFor(item);
  if (!absolute) return null;
  const query = new URLSearchParams({ path: absolute });
  const token = typeof window !== 'undefined' ? (window as any).electronAPI?.apiToken : null;
  if (typeof token === 'string' && token) query.set('t', token);
  return `${API_BASE}/api/media?${query.toString()}`;
}
