export interface ArchiveFormatInfo {
  format: string;
  encrypted?: boolean;
  passwordRequired?: boolean;
}

/**
 * Detecta el formato de archivo archive y proporciona info detallada.
 * Soporta: ZIP, RAR v4/v5, 7-Zip (.7z/.7zip), TAR (+GZIP/LZMA/BZIP2)
 */
export class ArchiveFormatDetector {
  /**
   * Detecta el formato de un archivo basado en magic bytes y extensión.
   */
  static async detect(fileName: string, fileBytes: Uint8Array | null = null): Promise<ArchiveFormatInfo> {
    const ext = fileName.split('.').pop()?.toUpperCase();

    // Extensiones mapeadas a formatos conocidos
    const formatMap: Record<string, string> = {
      ZIP: 'ZIP',
      RAR: 'RAR',
      R00: 'RAR',
      R01: 'RAR',
      R10: 'RAR',
      R99: 'RAR',
      '7Z': '7Z',
      '7ZIP': '7Z',
      TAR: 'TAR',
      TGZ: 'TAR.GZ',
      TBZ2: 'TAR.BZIP2',
      TZ: 'TAR.LZMA',
      TAZ: 'TAR.LZMA',
    };

    let format: string;

    if (ext && formatMap[ext]) {
      format = formatMap[ext];

      // Si hay bytes, verificar si está encriptado
      if (fileBytes) {
        try {
          const magic = fileBytes.slice(0, 16);

          // ZIP: PK signature (0x50 0x4B)
          if (magic[0] === 0x50 && magic[1] === 0x4b) {
            format = 'ZIP';
            // Comprobar si está encriptado (se detecta por errores al leer sin password)
            return { format, encrypted: false };
          }

          // RAR: RAR signature (0x52 0x61 0x72 0x21 - "Ra!")
          if (magic[0] === 0x52 && magic[1] === 0x61 && magic[2] === 0x72 && magic[3] === 0x21) {
            format = 'RAR';

            // RAR v4 vs v5: v5 tiene signature adicional (0x00 0x00)
            const signature = new Uint8Array(magic.slice(4, 8));
            if (signature[0] === 0 && signature[1] === 0) {
              return { format: 'RAR', encrypted: false };
            }
            return { format: 'RAR v4', encrypted: false };
          }

          // 7-Zip: 7zX signature (0x37 0x7A 0xBC 0xAF)
          if (magic[0] === 0x37 && magic[1] === 0x7a && magic[2] === 0xbc && magic[3] === 0xaf) {
            format = '7Z';
            return { format, encrypted: false };
          }

          // TAR: Ustar/Posix signature (0x41 0x55 0x53 0x54 0x41 0x52)
          if (magic[0] === 0x41 && magic[1] === 0x55 && magic[2] === 0x53 && magic[3] === 0x54) {
            format = 'TAR';
            return { format, encrypted: false };
          }
        } catch (error) {
          console.warn('ArchiveFormatDetector.detect:', error);
        }
      }

      return { format };
    } else if (ext === null) {
      // Sin extensión, intentar detectar por magic bytes
      if (!fileBytes) {
        return { format: 'unknown' };
      }

      const magic = fileBytes.slice(0, 20);

      // ZIP
      if (magic[0] === 0x50 && magic[1] === 0x4b) {
        return { format: 'ZIP', encrypted: false };
      }

      // RAR v5
      if (magic[0] === 0x52 && magic[1] === 0x61 && magic[2] === 0x72 && magic[3] === 0x21) {
        const signature = new Uint8Array(magic.slice(4, 8));
        if (signature[0] === 0 && signature[1] === 0) {
          return { format: 'RAR v5', encrypted: false };
        }
        return { format: 'RAR v4', encrypted: false };
      }

      // 7-Zip
      if (magic[0] === 0x37 && magic[1] === 0x7a) {
        return { format: '7Z', encrypted: false };
      }

      // TAR/GZIP/LZMA/BZIP2
      if (magic[0] === 0x41 && magic[1] === 0x55 && magic[2] === 0x53 && magic[3] === 0x54) {
        return { format: 'TAR', encrypted: false };
      }
    }

    // Si no se detecta nada, usar extensión o unknown
    return {
      format: ext || 'unknown',
    };
  }

  /**
   * Obtiene icono recomendado para formato.
   */
  static getFormatIcon(format: string): string {
    switch (format.toUpperCase()) {
      case 'ZIP':
        return 'archive';
      case 'RAR':
      case 'RAR v4':
      case 'RAR v5':
        return 'unarchive';
      case '7Z':
        return 'folder-open';
      case 'TAR':
        return 'file-archive';
      default:
        return 'file-archive';
    }
  }
}
