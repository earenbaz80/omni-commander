import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { loadArchiveBackend } from './archiveBackend';
import { crc32 } from './zipArchive';

/**
 * Opening a ZIP used to inflate every entry once just to verify the whole file,
 * which was measured at 92-95% of the time the open took. The archive is now
 * listed without that pass, and each entry is verified against the CRC-32 the
 * archive itself declares when it is read.
 *
 * These tests pin both halves: a damaged entry does not stop the listing, and it
 * is refused before its bytes reach a viewer, an extraction or the disk.
 */

/** A ZIP stored without compression, so flipping a byte is directly visible. */
async function storedZip(name: string, content: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
}

/** Flips one byte of an entry's data, leaving the declared checksum untouched. */
function corruptEntryData(bytes: Uint8Array, name: string): Uint8Array {
  const copy = new Uint8Array(bytes);
  for (let offset = 0; offset + 30 <= copy.length; offset++) {
    // Local file header signature: 50 4b 03 04.
    if (copy[offset] !== 0x50 || copy[offset + 1] !== 0x4b || copy[offset + 2] !== 0x03 || copy[offset + 3] !== 0x04) {
      continue;
    }
    const nameLength = copy[offset + 26] | (copy[offset + 27] << 8);
    const extraLength = copy[offset + 28] | (copy[offset + 29] << 8);
    const stored = copy.subarray(offset + 30, offset + 30 + nameLength);
    if (new TextDecoder().decode(stored) !== name) continue;
    const dataStart = offset + 30 + nameLength + extraLength;
    copy[dataStart] ^= 0xff;
    return copy;
  }
  throw new Error(`no local header for ${name}`);
}

describe('crc32', () => {
  it('calcula el CRC-32 que ZIP usa (vector de referencia)', () => {
    // The classic check value for "123456789" is 0xCBF43926.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('verificación de entradas de un ZIP', () => {
  it('abre un archivo dañado para listarlo, sin inflar cada entrada', async () => {
    const bytes = corruptEntryData(await storedZip('nota.txt', 'contenido original'), 'nota.txt');

    const backend = await loadArchiveBackend(bytes, 'prueba.zip');

    expect(backend.entries.map((entry) => entry.name)).toContain('nota.txt');
  });

  it('rechaza una entrada cuyo contenido no coincide con el CRC declarado', async () => {
    const backend = await loadArchiveBackend(
      corruptEntryData(await storedZip('nota.txt', 'contenido original'), 'nota.txt'),
      'prueba.zip',
    );
    const entry = backend.entries.find((candidate) => candidate.name === 'nota.txt');

    // The archive is what the user can act on, so it is what the message names.
    await expect(entry!.read()).rejects.toThrow(/prueba\.zip/);
    await expect(backend.readEntry('nota.txt')).rejects.toThrow(/prueba\.zip/);
  });

  it('devuelve el contenido de una entrada sana', async () => {
    const backend = await loadArchiveBackend(await storedZip('nota.txt', 'hola mundo'), 'prueba.zip');

    expect(new TextDecoder().decode(await backend.readEntry('nota.txt'))).toBe('hola mundo');
  });
});
