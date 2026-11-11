/**
 * The pane's browser is a native layer painted above the page, so a DOM overlay
 * that reaches into the pane — a pull-down from the menu bar — would end up
 * underneath it. The menu bar announces when one is open and the browser steps
 * aside; this module is the one name both sides agree on.
 */
export const OVERLAY_MENU_EVENT = 'omni:menu-open';

export function notifyMenuOpen(open: boolean): void {
  window.dispatchEvent(new CustomEvent<boolean>(OVERLAY_MENU_EVENT, { detail: open }));
}
