import React, { useRef, useState } from 'react';
import { Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { ThemeConfig } from '../services/themeManager';
import { useModalDialog } from '../hooks/useModalDialog';

interface ModalShellProps {
  title?: string;
  label?: string;
  theme: ThemeConfig;
  children: React.ReactNode;
  onClose?: () => void;
  overlay?: boolean;
  closeButtonLabel?: string;
  /**
   * Draws minimise and maximise/restore next to the close button, for dialogs
   * that behave like a window of their own (the map). The rest of the app's
   * dialogs are short-lived questions and keep the plain close button.
   */
  windowControls?: boolean;
  minimizeLabel?: string;
  maximizeLabel?: string;
  restoreLabel?: string;
  /** Told when the panel fills the viewport, so content can grow with it. */
  onMaximizeChange?: (maximized: boolean) => void;
}

/**
 * Consolidated modal shell component that provides consistent:
 * - Backdrop with z-index and overlay handling
 * - Header with title/label and close button
 * - Focus trap via useModalDialog hook
 * - Keyboard escape key handling
 * - Consistent stacking order
 */
function ModalShell({
  title,
  label,
  theme,
  children,
  onClose,
  overlay = true,
  closeButtonLabel = 'Cerrar modal',
  windowControls = false,
  minimizeLabel = 'Minimizar',
  maximizeLabel = 'Maximizar',
  restoreLabel = 'Restaurar',
  onMaximizeChange,
}: ModalShellProps): React.JSX.Element {
  const modalRef = useRef<HTMLDivElement>(null);
  // Rolled up to its title bar, like the window it imitates.
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);

  // Use the shared modal dialog hook for consistent behavior
  // Prefer explicit `label` for accessibility (aria-label), fallback to `title`
  const titleText = label || title || 'Modal';
  useModalDialog<HTMLDivElement>(titleText, modalRef);

  const toggleMaximized = () => {
    const next = !maximized;
    setMaximized(next);
    onMaximizeChange?.(next);
  };

  const controlButton =
    'p-[var(--space-1)] rounded hover:bg-black/20 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-[var(--space-4)]"
      style={{
        backgroundColor: overlay ? theme.overlay : 'transparent',
      }}
    >
      <div
        ref={modalRef}
        // A cap and a scroll area, not just `overflow-hidden`: a dialog taller
        // than the window used to be clipped at both ends with no way to reach
        // its footer (the folder-sync table grew past the screen edges).
        className={`relative flex flex-col overflow-hidden rounded border bg-app shadow-lg ${
          maximized ? 'h-full w-full max-w-none' : 'max-h-full w-full max-w-3xl'
        }`}
        style={{
          borderColor: theme.modalBorder,
          backgroundColor: theme.modalBg,
        }}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between px-[var(--space-4)] py-[var(--space-3)] border-b"
          style={{
            backgroundColor: theme.modalHeaderBg,
            borderColor: theme.modalBorder,
          }}
        >
          <h3 className="text-sm font-bold text-left" style={{ color: theme.modalHeaderText }}>
            {title || label}
          </h3>
          <div className="flex items-center gap-[var(--space-1)]">
            {windowControls && (
              <>
                <button
                  onClick={() => setMinimized((current) => !current)}
                  aria-label={minimizeLabel}
                  title={minimizeLabel}
                  aria-pressed={minimized}
                  className={controlButton}
                  style={{ color: theme.modalHeaderText }}
                >
                  <Minus size={16} />
                </button>
                <button
                  onClick={toggleMaximized}
                  aria-label={maximized ? restoreLabel : maximizeLabel}
                  title={maximized ? restoreLabel : maximizeLabel}
                  aria-pressed={maximized}
                  className={controlButton}
                  style={{ color: theme.modalHeaderText }}
                >
                  {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
              </>
            )}
            {onClose && (
              <button
                onClick={onClose}
                aria-label={closeButtonLabel}
                className={controlButton}
                style={{ color: theme.modalHeaderText }}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className={`min-h-0 overflow-y-auto p-[var(--space-4)] ${maximized ? 'flex-1' : ''}`} hidden={minimized}>
          {children}
        </div>

        {/* Footer - optional, can be conditionally rendered in child components */}
      </div>
    </div>
  );
}

export default ModalShell;
