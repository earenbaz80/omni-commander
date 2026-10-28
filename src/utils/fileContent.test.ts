import { describe, it, expect } from 'vitest';
import { BINARY_SNIFF_BYTES, MAX_TEXT_FILE_BYTES, decodeFileBytes } from './fileContent';

const bytesOf = (text: string) => new TextEncoder().encode(text);

describe('decodeFileBytes', () => {
  it('decodes text and reports nothing binary or partial', () => {
    const decoded = decodeFileBytes(bytesOf('hola\nmundo'));

    expect(decoded.text).toBe('hola\nmundo');
    expect(decoded.binary).toBe(false);
    expect(decoded.truncated).toBe(false);
    expect(decoded.bytes.length).toBe(10);
  });

  it('marks a file with a NUL as binary and keeps its bytes for the hex view', () => {
    const bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);

    const decoded = decodeFileBytes(bytes);

    expect(decoded.binary).toBe(true);
    // No text is offered, because writing a decoded string back would corrupt it.
    expect(decoded.text).toBe('');
    expect(Array.from(decoded.bytes)).toEqual([0x4d, 0x5a, 0x90, 0x00, 0x03]);
  });

  it('only judges from the first block, so a late NUL is not enough', () => {
    const bytes = new Uint8Array(BINARY_SNIFF_BYTES + 32);
    bytes.fill(0x41);
    bytes[bytes.length - 1] = 0;

    expect(decodeFileBytes(bytes).binary).toBe(false);
  });

  it('caps what it returns and says the view is partial', () => {
    const decoded = decodeFileBytes(bytesOf('x'.repeat(50)), 10);

    expect(decoded.truncated).toBe(true);
    expect(decoded.text).toBe('x'.repeat(10));
    expect(decoded.bytes.length).toBe(10);
  });

  it('replaces invalid bytes instead of throwing, so the file still opens', () => {
    const decoded = decodeFileBytes(new Uint8Array([0x41, 0xff, 0xfe, 0x42]));

    expect(decoded.text.startsWith('A')).toBe(true);
    expect(decoded.text.endsWith('B')).toBe(true);
  });

  it('reads at most two megabytes by default', () => {
    expect(MAX_TEXT_FILE_BYTES).toBe(2 * 1024 * 1024);
    expect(decodeFileBytes(new Uint8Array(MAX_TEXT_FILE_BYTES + 1)).truncated).toBe(true);
  });
});
