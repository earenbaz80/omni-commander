import React, { useEffect, useRef, useState } from 'react';
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
  /**
   * Lets the panel be dragged out by its bottom-right corner. A dialog that
   * behaves like a window is expected to be resizable like one.
   */
  resizable?: boolean;
  resizeLabel?: string;
  /**
   * The body takes the remaining height and hands it to its content instead of
   * scrolling it. Dialogs whose content has a height of its own (the map) need
   * this to grow with the panel.
   */
  fill?: boolean;
  /**
   * Told whether the panel has a definite height — it was maximised or dragged
   * to a size — so content can fill it rather than keep a fixed height.
   */
  onFillChange?: (fills: boolean) => void;
}

/** Below this the dialog is unusable, whatever the drag says. */
const MIN_PANEL_WIDTH = 320;
const MIN_PANEL_HEIGHT = 220;
/** The overlay's own inset, kept clear so the panel never touches an edge. */
const SCREEN_GUTTER = 32;

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
  resizable = false,
  resizeLabel = 'Redimensionar ventana',
  fill = false,
  onFillChange,
}: ModalShellProps): React.JSX.Element {
  const modalRef = useRef<HTMLDivElement>(null);
  // Rolled up to its title bar, like the window it imitates.
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  /** The size the corner was dragged out to; `null` means the dialog's own. */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const dragging = useRef<{
    pointerId: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Use the shared modal dialog hook for consistent behavior
  // Prefer explicit `label` for accessibility (aria-label), fallback to `title`
  const titleText = label || title || 'Modal';
  useModalDialog<HTMLDivElement>(titleText, modalRef);

  // A dialog with a height of its own either fills the viewport or was dragged
  // to a size; either way its content is expected to grow with it. The map used
  // to guess the chrome away with `calc(100vh - …)`, which left it the same
  // height on a maximised window as on a small one.
  const fills = maximized || size !== null;

  useEffect(() => {
    onFillChange?.(fills);
  }, [fills, onFillChange]);

  const toggleMaximized = () => {
    setMaximized((current) => !current);
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const panel = modalRef.current;
    if (!panel || maximized) return;
    const rect = panel.getBoundingClientRect();
    dragging.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
    };
    // The pointer leaves the small corner as soon as the drag starts; without
    // the capture the panel would stop following it a few pixels later.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* no active pointer to capture on this platform */
    }
    event.preventDefault();
  };

  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragging.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const widest = Math.max(MIN_PANEL_WIDTH, window.innerWidth - SCREEN_GUTTER);
    const tallest = Math.max(MIN_PANEL_HEIGHT, window.innerHeight - SCREEN_GUTTER);
    setSize({
      width: Math.min(widest, Math.max(MIN_PANEL_WIDTH, start.width + event.clientX - start.x)),
      height: Math.min(tallest, Math.max(MIN_PANEL_HEIGHT, start.height + event.clientY - start.y)),
    });
  };

  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragging.current;
    if (!start || start.pointerId !== event.pointerId) return;
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const controlButton =
    'p-[var(--space-1)] rounded hover:bg-black/20 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  // `max-w-none` is what lets a dragged panel pass the dialog width it was
  // designed for; the inline size is clamped to the viewport above.
  const panelSizeClass = maximized ? 'h-full w-full max-w-none' : size ? 'max-w-none' : 'max-h-full w-full max-w-3xl';

  const bodyClass = fill
    ? `min-h-0 flex flex-col p-[var(--space-4)] ${fills ? 'flex-1 overflow-hidden' : 'overflow-y-auto'}`
    : `min-h-0 overflow-y-auto p-[var(--space-4)] ${maximized ? 'flex-1' : ''}`;

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
        className={`relative flex flex-col overflow-hidden rounded border bg-app shadow-lg ${panelSizeClass}`}
        style={{
          borderColor: theme.modalBorder,
          backgroundColor: theme.modalBg,
          ...(size && !maximized ? { width: size.width, height: size.height } : null),
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
        <div className={bodyClass} hidden={minimized}>
          {children}
        </div>

        {/* A window is resizeable by its corner; a maximised one already fills the screen. */}
        {resizable && !maximized && (
          <div
            role="separator"
            aria-label={resizeLabel}
            title={resizeLabel}
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onLostPointerCapture={endResize}
            className="absolute bottom-0 right-0 flex h-4 w-4 cursor-nwse-resize touch-none items-end justify-end"
            style={{ color: theme.modalBorder }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
              <path d="M9 2 L2 9 M9 6 L6 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
            </svg>
          </div>
        )}

        {/* Footer - optional, can be conditionally rendered in child components */}
      </div>
    </div>
  );
}

export default ModalShell;
