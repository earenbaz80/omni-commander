import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FileItem } from '../types';
import { getTranslations } from '../i18n/translations';
import { AppModalLayer, type AppModalLayerProps } from './AppModalLayer';

// The dialogs themselves have their own tests; what this file pins is the
// wiring between them, which is what moved out of App.
const captured = vi.hoisted(() => ({
  modals: null as Record<string, unknown> | null,
  conflict: null as Record<string, unknown> | null,
}));

vi.mock('./AppModals', () => ({
  AppModals: (props: Record<string, unknown>) => {
    captured.modals = props;
    return null;
  },
}));

vi.mock('./modals/ConflictPromptModal', () => ({
  ConflictPromptModal: (props: Record<string, unknown>) => {
    captured.conflict = props;
    return null;
  },
}));

const file = (id: string) => ({ id, name: id, isDirectory: false }) as unknown as FileItem;

function setup(options: { items?: FileItem[]; modalItems?: FileItem[]; conflict?: boolean; visible?: boolean } = {}) {
  const onToggle = vi.fn();
  const handleResolveConflict = vi.fn();
  const props = {
    ui: {
      theme: { headerBg: '#000', headerText: '#fff', borderPanel: '#111' },
      lang: 'es',
      settings: {},
      setSettings: vi.fn(),
    },
    panels: {},
    modal: {
      activeModal: 'copy',
      modalData: { type: 'copy', items: options.modalItems },
      setActiveModal: vi.fn(),
      setModalData: vi.fn(),
      selectedFileForModal: null,
      unlockTarget: null,
      setUnlockTarget: vi.fn(),
      cleanupTarget: 'user-temp',
    },
    transfers: {
      items: options.items ?? [],
      queue: { conflictPrompt: options.conflict ? { some: 'conflict' } : null, handleResolveConflict },
      passwordRequest: null,
      submitPassword: vi.fn(),
    },
    files: {},
    commands: {},
    treeHandle: { visible: options.visible ?? false, onToggle, buttonRef: { current: null } },
  } as unknown as AppModalLayerProps;

  return { props, onToggle, handleResolveConflict };
}

describe('AppModalLayer', () => {
  it("borrows the queue's items when the transfer snapshot arrived empty", () => {
    const { props } = setup({ items: [file('a'), file('b')], modalItems: [] });

    render(<AppModalLayer {...props} />);

    const modalData = captured.modals?.modalData as { items: FileItem[] };
    expect(modalData.items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it("keeps the snapshot's own items instead of replacing them", () => {
    const { props } = setup({ items: [file('a')], modalItems: [file('z')] });

    render(<AppModalLayer {...props} />);

    const modalData = captured.modals?.modalData as { items: FileItem[] };
    expect(modalData.items.map((item) => item.id)).toEqual(['z']);
  });

  it('hands an extraction conflict answer to the extraction resolver', () => {
    const handleResolveExtractConflict = vi.fn();
    const { props } = setup();
    props.files = {
      extractConflict: { name: 'nota.txt' },
      handleResolveExtractConflict,
      handleAbortExtractConflict: vi.fn(),
    } as never;

    render(<AppModalLayer {...props} />);
    (captured.conflict?.onAnswer as (answer: string, all: boolean) => void)('rename', true);

    expect(handleResolveExtractConflict).toHaveBeenCalledWith('rename', true);
  });

  it("hands a conflict answer to the queue's own resolver", () => {
    const { props, handleResolveConflict } = setup({ conflict: true });

    render(<AppModalLayer {...props} />);
    (captured.conflict?.onAnswer as (answer: string) => void)('overwrite');

    expect(handleResolveConflict).toHaveBeenCalledWith('overwrite');
  });

  it('labels the tree handle in the app language and flips its glyph with the state', () => {
    const closed = setup({ visible: false });
    const { container, unmount } = render(<AppModalLayer {...closed.props} />);
    const button = container.querySelector('button') as HTMLButtonElement;

    expect(button.title).toBe(getTranslations('es').toggleTreeTooltip);
    expect(button.textContent).toBe('▷');
    button.click();
    expect(closed.onToggle).toHaveBeenCalledTimes(1);
    unmount();

    const open = setup({ visible: true });
    const opened = render(<AppModalLayer {...open.props} />);
    expect(opened.container.querySelector('button')?.textContent).toBe('◁');
  });
});
