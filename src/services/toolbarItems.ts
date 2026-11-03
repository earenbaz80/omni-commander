import type { TranslationKey } from '../i18n/translations';

/**
 * The toolbar's buttons, in the order a fresh profile shows them.
 *
 * The row used to be hard-coded in the component, so hiding one button or
 * moving it meant editing JSX. Every command is now an id the settings file can
 * omit and reorder; ids this build no longer knows are dropped on load instead
 * of lingering in the saved list forever.
 */
export interface ToolbarItemDefinition {
  id: string;
  /** Label used by the toolbar tooltip and by the settings list. */
  labelKey: TranslationKey;
}

export const TOOLBAR_ITEMS: readonly ToolbarItemDefinition[] = [
  { id: 'newFolder', labelKey: 'toolbarNewFolder' },
  { id: 'copy', labelKey: 'copy' },
  { id: 'move', labelKey: 'move' },
  { id: 'delete', labelKey: 'toolbarDelete' },
  { id: 'search', labelKey: 'toolbarSearch' },
  { id: 'filter', labelKey: 'toolbarFilter' },
  { id: 'refresh', labelKey: 'toolbarRefresh' },
  { id: 'properties', labelKey: 'toolbarProperties' },
  { id: 'diskUsage', labelKey: 'diskUsageTreeTitle' },
  { id: 'diskPane', labelKey: 'diskPaneOpen' },
  { id: 'layout', labelKey: 'panelLayoutColumns' },
  { id: 'cleanup', labelKey: 'toolbarCleanup' },
];

export const DEFAULT_TOOLBAR_ITEMS: string[] = TOOLBAR_ITEMS.map((item) => item.id);

/**
 * What to draw, in order. A saved list keeps both its order and its omissions;
 * a profile with no list at all gets every command.
 */
export function resolveToolbarItems(saved?: string[]): string[] {
  if (!Array.isArray(saved)) return [...DEFAULT_TOOLBAR_ITEMS];
  const known = new Set(DEFAULT_TOOLBAR_ITEMS);
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const id of saved) {
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    resolved.push(id);
  }
  return resolved;
}

/** Hides a command that is shown, shows one that is hidden, at the end. */
export function toggleToolbarItem(saved: string[] | undefined, id: string): string[] {
  const current = resolveToolbarItems(saved);
  return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
}

/** Moves a command one place earlier or later, leaving the rest untouched. */
export function moveToolbarItem(saved: string[] | undefined, id: string, direction: -1 | 1): string[] {
  const current = resolveToolbarItems(saved);
  const index = current.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= current.length) return current;
  const next = [...current];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
