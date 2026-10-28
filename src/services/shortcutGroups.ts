import type { getTranslations } from '../i18n/translations';

/** The translated table both the manual and Settings > Shortcuts render. */
type Trans = ReturnType<typeof getTranslations>;

export interface ShortcutGroup {
  title: string;
  shortcuts: Array<{ key: string; desc: string }>;
}

/**
 * The keys this app actually answers to, in the groups the manual lists them.
 *
 * It lives here, apart from either screen, because Settings > Shortcuts and the
 * help manual have to say the same thing: a shortcut that changes in the code
 * changes in one place, and neither list can drift into another app's scheme.
 */
export function buildShortcutGroups(t: Trans): ShortcutGroup[] {
  return [
    {
      title: t.helpGroupFunctionKeys,
      shortcuts: [
        { key: 'F1', desc: t.helpScF1 },
        { key: 'F2', desc: t.helpScF2 },
        { key: 'F3', desc: t.helpScF3 },
        { key: 'F4', desc: t.helpScF4 },
        { key: 'F5', desc: t.helpScF5 },
        { key: 'F6', desc: t.helpScF6 },
        { key: 'F7', desc: t.helpScF7 },
        { key: 'F8 / Del', desc: t.helpScF8 },
        { key: 'F9', desc: t.helpScF9 },
        { key: 'F10', desc: t.helpScF10 },
      ],
    },
    {
      title: t.helpGroupNavigation,
      shortcuts: [
        { key: 'Tab', desc: t.helpScTab },
        { key: 'Enter', desc: t.helpScEnter },
        { key: 'Backspace / ..', desc: t.helpScBackspace },
        { key: 'Ctrl + T', desc: t.helpScCtrlT },
        { key: 'Ctrl + W', desc: t.helpScCtrlW },
        { key: 'Alt + F1', desc: t.helpScAltF1 },
        { key: 'Alt + F2', desc: t.helpScAltF2 },
        { key: 'Ctrl + R', desc: t.helpScCtrlR },
        { key: 'Ctrl + Q', desc: t.helpScCtrlQ },
        { key: 'Ctrl + Shift + R', desc: t.helpScCtrlShiftR },
      ],
    },
    {
      title: t.helpGroupSelection,
      shortcuts: [
        { key: t.helpKeySpaceInsert, desc: t.helpScSpaceInsert },
        { key: 'Ctrl + A', desc: t.helpScCtrlA },
        { key: '*', desc: t.helpScInvert },
        { key: 'Ctrl + F', desc: t.helpScCtrlF },
        { key: 'Alt + Enter', desc: t.helpScAltEnter },
        { key: 'Ctrl + D', desc: t.helpScCtrlD },
        { key: 'Ctrl + M', desc: t.helpScCtrlM },
        { key: 'Alt + F7', desc: t.helpScAltF7 },
        { key: 'Ctrl + H', desc: t.helpScCtrlH },
      ],
    },
  ];
}
