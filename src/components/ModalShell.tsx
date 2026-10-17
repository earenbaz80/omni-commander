import React from 'react';
import { useModalDialog } from '../hooks/useModalDialog';

interface ModalShellProps {
  children: React.ReactNode;
  /** Accessible name of the dialog (announced by screen readers). */
  label: string;
  /** Classes applied to the dialog panel. */
  panelClassName?: string;
  /** Inline styles applied to the dialog panel. */
  panelStyle?: React.CSSProperties;
}

/**
 * Shared modal frame. The accessibility behaviour (dialog role, accessible
 * name, Tab focus trap, focus restoration) lives in useModalDialog so every
 * modal can opt in the same way.
 *
 * Escape is already handled globally by App (keyboard engine), so it is
 * deliberately not duplicated here.
 */
export const ModalShell: React.FC<ModalShellProps> = ({
  children,
  label,
  panelClassName = '',
  panelStyle,
}) => {
  const dialogRef = useModalDialog<HTMLDivElement>(label);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={panelClassName}
        style={panelStyle}
      >
        {children}
      </div>
    </div>
  );
};

export default ModalShell;