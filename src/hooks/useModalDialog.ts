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
 * Makes any attached element behave like an accessible modal dialog.
 *
 * Attach the returned ref to the dialog panel and nothing else: the hook adds
 * `role="dialog"`, `aria-modal`, the accessible name, traps Tab focus inside
 * the panel and restores focus to whatever opened it.
 *
 * Escape is intentionally not handled here: App owns the global keyboard
 * engine and already closes the active modal.
 */
export function useModalDialog<T extends HTMLElement>(
  label: string,
  externalRef?: React.RefObject<T>
) {
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

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const firstFocusable = panel.querySelector<HTMLElement>(MODAL_FOCUSABLE_SELECTOR);
    (firstFocusable ?? panel).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)
      );
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
      previouslyFocused?.focus?.();
    };
  }, [ref]);

  return ref;
}
