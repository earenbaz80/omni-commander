/**
 * Extensions whose default shell action starts something: programs and scripts
 * Windows executes, shortcuts that resolve to their target, installers, Control
 * Panel applets and management consoles. Where the host has a shell, Enter and
 * a double click on one of these hand it over; the rest of the files open in
 * the viewer, except archives, which mount as folders.
 */
export const RUNNABLE_EXTENSIONS = ['EXE', 'COM', 'BAT', 'CMD', 'LNK', 'MSI', 'CPL', 'MSC'];

/** The same list in the spelling the manual shows: `.exe, .com, ...`. */
export const runnableExtensionsLabel = (): string =>
  RUNNABLE_EXTENSIONS.map((ext) => `.${ext.toLowerCase()}`).join(', ');
