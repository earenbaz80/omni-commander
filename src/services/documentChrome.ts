import type { LanguageCode } from '../types';
import type { ThemeConfig } from './themeManager';

/**
 * Keeps the document language and the palette's shared ink variables in step.
 *
 * index.html ships lang="es"; without this the attribute would stay Spanish no
 * matter which language the user selects. Danger and warning ink is part of the
 * palette: the dialogs ask for these two variables instead of naming a rose, a
 * red or an amber, so switching theme repaints every failure and every caution
 * in one go.
 */
export function applyDocumentChrome(lang: LanguageCode, theme: ThemeConfig): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.style.setProperty('--nc-danger', theme.accentDanger);
  document.documentElement.style.setProperty('--nc-warn', theme.accentWarn);
  document.documentElement.style.setProperty('--nc-ok', theme.accentOk);
}
