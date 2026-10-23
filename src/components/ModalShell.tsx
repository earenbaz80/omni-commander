import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { ThemeConfig } from '../services/themeManager';
import { useModalDialog } from '../hooks/useModalDialog';

interface ModalShellProps {
  title?: string;
  label?: string;
  theme: ThemeConfig;
  children: React.ReactNode;
  onClose?: () => void;
  overlay?: boolean;
  autoFocusOnOpen?: boolean;
  closeButtonLabel?: string;
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
  autoFocusOnOpen = false,
  closeButtonLabel = 'Cerrar modal',
}: ModalShellProps): React.JSX.Element {
  const modalRef = useRef<HTMLDivElement>(null);

  // Use the shared modal dialog hook for consistent behavior
  // Prefer explicit `label` for accessibility (aria-label), fallback to `title`
  const titleText = label || title || 'Modal';
  useModalDialog(titleText, modalRef);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{
        backgroundColor: overlay ? theme.overlay : 'transparent',
      }}
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-3xl overflow-hidden rounded border bg-app shadow-lg"
        style={{
          borderColor: theme.modalBorder,
          backgroundColor: theme.modalBg,
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 border-b"
          style={{
            backgroundColor: theme.modalHeaderBg,
            borderColor: theme.modalBorder,
          }}
        >
          <h3
            className="text-sm font-bold text-left"
            style={{ color: theme.modalHeaderText }}
          >
            {title || label}
          </h3>
          {onClose && (
            <button
              onClick={onClose}
              aria-label={closeButtonLabel}
              className="p-1 rounded hover:bg-black/20 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{ color: theme.modalHeaderText }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-4">{children}</div>

        {/* Footer - optional, can be conditionally rendered in child components */}
      </div>
    </div>
  );
}

export default ModalShell;