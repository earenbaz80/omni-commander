// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { loadArchiveBackend } from './archiveBackend';

/**
 * Opening an archive lists its entries before anyone opens one. That listing used
 * to inflate every entry in the file just to learn its size, so a ZIP with
 * thousands of entries blocked the renderer and multiplied the memory it held.
 * The size is already in the archive's central directory, and the list must read
 * it from there; the bytes only come out when an entry is opened.
 */

async function zipWith(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('entradas de un ZIP', () => {
  it('mide cada entrada por el tamaño declarado, sin descomprimirla', async () => {
    const content = 'repetido '.repeat(4000);
    const bytes = await zipWith({ 'carpeta/informe.txt': content, 'vacio.txt': '' });
    // `async` is the only public way to inflate an entry, so spying on it is how
    // "the listing did not decompress anything" becomes observable.
    const probe = await JSZip.loadAsync(bytes);
    const asyncSpy = vi.spyOn(Object.getPrototypeOf(probe.files['carpeta/informe.txt']), 'async');

    const backend = await loadArchiveBackend(bytes, 'prueba.zip');

    expect(asyncSpy).not.toHaveBeenCalled();
    const informe = backend.entries.find((entry) => entry.name === 'carpeta/informe.txt');
    expect(informe?.size).toBe(content.length);
    // Zero is a declared size too, not a missing one.
    expect(backend.entries.find((entry) => entry.name === 'vacio.txt')?.size).toBe(0);
  });

  it('sigue devolviendo el contenido cuando se abre una entrada', async () => {
    const content = 'hola mundo';
    const backend = await loadArchiveBackend(await zipWith({ 'nota.txt': content }), 'prueba.zip');

    const entry = backend.entries.find((candidate) => !candidate.dir);
    expect(entry).toBeDefined();
    expect(new TextDecoder().decode(await entry!.read())).toBe(content);
    expect(new TextDecoder().decode(await backend.readEntry('nota.txt'))).toBe(content);
  });
});
