import { useEffect, useRef } from 'react';

export const MODAL_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Where focus has been outside dialogs, newest last.
 *
 * Reading `document.activeElement` when a window mounts is not an answer to
 * "what opened it": a window whose body has an `autoFocus` field has already
 * moved focus inside itself by the time its effects run, and a window that
 * appears after a lazy chunk can mount once the window it replaces is gone. In
 * both cases the hook remembered a node that disappears with the dialog, and
 * closing it restored nothing — focus fell to the body.
 *
 * A history rather than a single element, because an `autoFocus` field can grab
 * focus before its panel carries `role="dialog"`: that focusin looks like an
 * outside one at the time it happens, so the newest entry cannot be trusted on
 * its own. The hook picks the newest entry that is still in the document and
 * not part of its own panel.
 */
const outsideFocusHistory: HTMLElement[] = [];
const HISTORY_LIMIT = 8;
let trackingFocus = false;

function trackFocusOutsideDialogs(): void {
  if (trackingFocus || typeof document === 'undefined') return;
  trackingFocus = true;
  document.addEventListener(
    'focusin',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest('[role="dialog"]')) return;
      if (outsideFocusHistory[outsideFocusHistory.length - 1] === target) return;
      outsideFocusHistory.push(target);
      if (outsideFocusHistory.length > HISTORY_LIMIT) outsideFocusHistory.shift();
    },
    true,
  );
}

// At load, not when the first window mounts: by then the list or the button that
// will open it has already been focused, and that focusin would have been missed.
trackFocusOutsideDialogs();

/** Newest recorded element still in the document and not part of `panel`. */
function lastFocusedOutside(panel: HTMLElement): HTMLElement | null {
  for (let index = outsideFocusHistory.length - 1; index >= 0; index--) {
    const candidate = outsideFocusHistory[index];
    if (candidate.isConnected && !panel.contains(candidate)) return candidate;
  }
  return null;
}

/**
 * Where focus goes when the control that opened the window is gone.
 *
 * The history can come up empty: a window opened by a global key right after a
 * reload (F10, never having clicked anything) has no recorded opener at all, and
 * every other entry may belong to a panel that was replaced while the window was
 * up. Restoring nothing leaves focus on the body, where the next keystroke goes
 * nowhere. The file list is the keyboard's home in this app — focusable, named
 * and the owner of the arrows — so it is the landing spot of last resort.
 *
 * The active panel's list wins when both are on screen: the user was working
 * there, and landing on the other side would silently move the keyboard.
 */
const FOCUS_FALLBACK_SELECTORS = ['[data-file-list-active="true"]', '[data-file-list]'];

function fallbackFocusTarget(panel: HTMLElement): HTMLElement | null {
  // Two passes, not one selector list: the inactive panel's list comes first in
  // document order, and a comma selector would hand the keyboard to the panel
  // the user is not working in.
  for (const selector of FOCUS_FALLBACK_SELECTORS) {
    for (const candidate of document.querySelectorAll<HTMLElement>(selector)) {
      if (!candidate.isConnected || panel.contains(candidate)) continue;
      if (candidate.closest('[role="dialog"]')) continue;
      return candidate;
    }
  }
  return null;
}

/**
 * Makes any attached element behave like an accessible modal dialog.
 *
 * Attach the returned ref to the dialog panel and nothing else: the hook adds
 * `role="dialog"`, `aria-modal`, the accessible name, traps Tab focus inside
 * the panel and restores focus to whatever opened it — or, when that control is
 * gone, to the file list of the active panel.
 *
 * Escape is intentionally not handled here: App owns the global keyboard
 * engine and already closes the active modal.
 */
export function useModalDialog<T extends HTMLElement>(label: string, externalRef?: React.RefObject<T>) {
  const internalRef = useRef<T>(null);
  const ref = externalRef ?? internalRef;

  // Dialog semantics (attributes only, safe to re-run when the label changes).
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;

    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', label);

    return () => {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
      panel.removeAttribute('aria-label');
    };
  }, [label, ref]);

  // Focus management: enter on mount, trap Tab, restore on unmount.
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;

    // Where focus was before any window was in the way; resolved again on the
    // way out, which is when a window replacing another has already restored.

    const firstFocusable = panel.querySelector<HTMLElement>(MODAL_FOCUSABLE_SELECTOR);
    (firstFocusable ?? panel).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR));
      if (focusables.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      // Drive Tab ourselves: the trap must not rely on the browser default so it
      // also works under jsdom (tests) and with sub-controls that swallow focus.
      event.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      const index = active ? focusables.indexOf(active) : -1;
      const nextIndex = event.shiftKey
        ? index <= 0
          ? focusables.length - 1
          : index - 1
        : (index + 1) % focusables.length;
      focusables[nextIndex].focus();
    };

    panel.addEventListener('keydown', handleKeyDown);

    return () => {
      panel.removeEventListener('keydown', handleKeyDown);
      // A node that is gone cannot take focus back; calling focus() on it is a
      // silent no-op that would leave focus wherever the browser put it. When
      // nothing recorded survives, the fallback keeps the keyboard on the list
      // instead of on the body.
      (lastFocusedOutside(panel) ?? fallbackFocusTarget(panel))?.focus();
    };
  }, [ref]);

  return ref;
}
