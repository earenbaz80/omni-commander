/**
 * The one place an old drive record gets its explicit root.
 *
 * Saved drive lists written before `root` existed carry only the display label.
 * That label is enough to reconstruct a Windows root and, for the Linux adapter,
 * is the mount point itself. New server answers always carry `root`, so this is
 * a migration and never the way a path is composed at runtime.
 */
export function rootFromDriveFields(root: unknown, letter: unknown): string {
  const explicit = typeof root === 'string' ? root.trim() : '';
  if (explicit) return explicit;

  const label = typeof letter === 'string' ? letter.trim() : '';
  if (!label) return '';
  if (label.startsWith('/')) return label;

  const letterRoot = /^([A-Za-z]):[\\/]?$/.exec(label);
  return letterRoot ? `${letterRoot[1].toUpperCase()}:\\` : '';
}

export function withDriveRoot<T extends { letter: string; root?: string }>(drive: T): T & { root: string } {
  const root = rootFromDriveFields(drive.root, drive.letter);
  return root === drive.root ? (drive as T & { root: string }) : { ...drive, root };
}
