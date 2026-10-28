/**
 * Names the format of an archive so the interface can talk about it.
 *
 * The decision about what can actually be opened lives in `archiveBackend`, and
 * this delegates to it rather than keeping a second, drifting table. It used to
 * claim support for "ZIP, RAR v4/v5, 7-Zip, TAR" while the engine could only
 * read ZIP, which is how an unreadable file ended up reported as corrupt
 * instead of as a RAR.
 */
import {
  detectArchiveFormat,
  formatFromExtension,
  formatLabel,
  isOpenable,
  type ArchiveFormatName,
} from './archiveBackend';

export interface ArchiveFormatInfo {
  format: ArchiveFormatName;
  label: string;
  openable: boolean;
}

export class ArchiveFormatDetector {
  /**
   * Detects a format from magic bytes when the content is available, and falls
   * back to the file name otherwise, so callers that have not read the file yet
   * still get an answer.
   */
  static async detect(fileName: string, fileBytes?: Uint8Array | null): Promise<ArchiveFormatInfo> {
    const format =
      fileBytes && fileBytes.length > 0
        ? await detectArchiveFormat(fileName, fileBytes)
        : formatFromExtension(fileName);
    return { format, label: formatLabel(format), openable: isOpenable(format) };
  }

  /** Icon name recommended for a format. */
  static getFormatIcon(format: string): string {
    switch (format.toUpperCase()) {
      case 'ZIP':
        return 'archive';
      case 'RAR':
      case 'RAR V4':
      case 'RAR V5':
        return 'unarchive';
      case '7Z':
        return 'folder-open';
      case 'TAR':
      case 'TAR.GZ':
        return 'file-archive';
      default:
        return 'file-archive';
    }
  }
}
