/**
 * How much of a file the viewer and the editor read. The whole file is not an
 * option: a stray multi-gigabyte file would freeze the window while it was
 * decoded, so the read is capped and the UI says the view is partial.
 */
export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

/** Bytes inspected for a NUL, which is what makes a file "not text" here. */
export const BINARY_SNIFF_BYTES = 8192;

export interface DecodedFileContent {
  /** File text, empty when the bytes are binary. */
  text: string;
  /** True when the bytes look like binary, so text must not be written back. */
  binary: boolean;
  /** True when only the first `maxBytes` were read. */
  truncated: boolean;
  /** The bytes themselves, capped, for the hex view. */
  bytes: Uint8Array;
}

/**
 * Turns raw file bytes into what the viewer and the editor can show. Text is
 * decoded as UTF-8 with replacement characters rather than throwing, so a file
 * with a stray invalid byte still opens instead of blanking the view, and a NUL
 * in the first block marks the file as binary so nothing writes a lossy string
 * over it.
 */
export function decodeFileBytes(bytes: Uint8Array, maxBytes = MAX_TEXT_FILE_BYTES): DecodedFileContent {
  const truncated = bytes.length > maxBytes;
  const capped = truncated ? bytes.subarray(0, maxBytes) : bytes;
  const binary = capped.subarray(0, BINARY_SNIFF_BYTES).includes(0);
  return {
    text: binary ? '' : new TextDecoder('utf-8').decode(capped),
    binary,
    truncated,
    bytes: capped,
  };
}
