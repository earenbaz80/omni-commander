import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { ActiveModal, FileItem, ModalData } from '../types';
import { soundManager } from '../services/soundEffects';

/**
 * Where the live selection comes from.
 *
 * It arrives as a ref because the panel hook that knows what is selected needs
 * the modal setter in return: one of the two has to be late-bound, and the
 * selection is the one that changes every render anyway.
 */
export interface SelectionSource {
  current: () => FileItem[];
}

export interface ModalStack {
  activeModal: ActiveModal;
  /** Opens a transfer dialog with a snapshot of the selection, or any other one as asked. */
  setActiveModal: Dispatch<SetStateAction<ActiveModal>>;
  modalData: ModalData | null;
  setModalData: Dispatch<SetStateAction<ModalData | null>>;
  selectedFileForModal: FileItem | null;
  setSelectedFileForModal: Dispatch<SetStateAction<FileItem | null>>;
  /** What the transfer dialogs preview: their own snapshot, or the live selection. */
  transferItems: FileItem[];
  handleTriggerCopy: () => void;
  handleTriggerMove: () => void;
  handleTriggerDelete: () => void;
}

/** The dialogs that act on a list of files, and therefore need one to open. */
function isSelectionModal(modal: ActiveModal): modal is 'copy' | 'move' | 'delete' {
  return modal === 'copy' || modal === 'move' || modal === 'delete';
}

/**
 * The modal a window can have open, and the transfer funnel the whole app goes
 * through.
 *
 * Copy, move and delete act on a snapshot rather than on the live selection:
 * the dialog previews one list and the confirm handler transfers that same list,
 * so a selection that changes behind an open dialog cannot make them disagree.
 * Snapshotting on open — not on close — is what keeps the snapshot honest; the
 * earlier code read the previous snapshot back, which made every later transfer
 * silently repeat the first one.
 *
 * Opening one of those dialogs with nothing selected sets no modal at all: the
 * call reports "handled" so the caller does not fall through to opening an empty
 * dialog.
 */
export function useModalStack(selection: SelectionSource): ModalStack {
  const [activeModal, setActiveModalState] = useState<ActiveModal>(null);
  const [modalData, setModalData] = useState<ModalData | null>(null);
  const [selectedFileForModal, setSelectedFileForModal] = useState<FileItem | null>(null);

  const openTransferModal = useCallback(
    (modal: ActiveModal): boolean => {
      if (!isSelectionModal(modal)) return false;
      const snapshot = selection.current();
      if (snapshot.length === 0) return true;
      soundManager.playKeyTick();
      setModalData({ items: snapshot, type: modal });
      setActiveModalState(modal);
      return true;
    },
    [selection],
  );

  // One funnel for every entry point — toolbar, menu bar, user menu, F-key bar —
  // so none of them can open a transfer dialog without a snapshot.
  const setActiveModal: Dispatch<SetStateAction<ActiveModal>> = useCallback(
    (action) => {
      if (typeof action === 'string' && openTransferModal(action)) return;
      setActiveModalState(action);
    },
    [openTransferModal],
  );

  const handleTriggerCopy = useCallback(() => {
    openTransferModal('copy');
  }, [openTransferModal]);

  const handleTriggerMove = useCallback(() => {
    openTransferModal('move');
  }, [openTransferModal]);

  const handleTriggerDelete = useCallback(() => {
    openTransferModal('delete');
  }, [openTransferModal]);

  // Falling back to the live selection guarantees a transfer can never run
  // against zero sources, even when an entry point forgets to snapshot.
  const transferItems: FileItem[] = modalData?.items?.length ? modalData.items : selection.current();

  return {
    activeModal,
    setActiveModal,
    modalData,
    setModalData,
    selectedFileForModal,
    setSelectedFileForModal,
    transferItems,
    handleTriggerCopy,
    handleTriggerMove,
    handleTriggerDelete,
  };
}
