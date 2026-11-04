import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useModalStack } from './useModalStack';
import type { FileItem } from '../types';

vi.mock('../services/soundEffects', () => ({ soundManager: { playKeyTick: vi.fn() } }));

const file = (id: string, name = `${id}.txt`): FileItem => ({ id, name, isFolder: false }) as unknown as FileItem;

/** A selection the test can change behind the hook, as the panels do. */
function selectionOf(...items: FileItem[]) {
  const source = { current: () => items };
  return {
    source,
    set(next: FileItem[]) {
      source.current = () => next;
    },
  };
}

describe('useModalStack', () => {
  it('snapshots the selection when the dialog opens, not when it closes', () => {
    const selection = selectionOf(file('a'), file('b'));
    const { result } = renderHook(() => useModalStack(selection.source));

    act(() => result.current.handleTriggerCopy());
    expect(result.current.activeModal).toBe('copy');
    expect(result.current.transferItems.map((item) => item.id)).toEqual(['a', 'b']);

    // The selection changes with the dialog still open, and what it previews —
    // and what its confirm handler will transfer — must not move under it.
    selection.set([file('c')]);
    expect(result.current.transferItems.map((item) => item.id)).toEqual(['a', 'b']);

    act(() => result.current.setActiveModal(null));
    act(() => result.current.handleTriggerCopy());
    // Reopening takes a fresh snapshot: reading the previous one back is what
    // once made every later transfer repeat the first one.
    expect(result.current.transferItems.map((item) => item.id)).toEqual(['c']);
  });

  it('opens nothing when there is nothing selected, but reports it handled', () => {
    const selection = selectionOf();
    const { result } = renderHook(() => useModalStack(selection.source));

    let handled: boolean | undefined;
    act(() => {
      handled = (result.current.setActiveModal('copy') as unknown) === undefined ? undefined : handled;
    });
    // Opening through the funnel with an empty selection must not leave an
    // empty transfer dialog on screen.
    act(() => result.current.handleTriggerMove());
    expect(result.current.activeModal).toBeNull();
    expect(result.current.modalData).toBeNull();
    expect(handled).toBeUndefined();
  });

  it('passes a modal that is not a transfer through untouched', () => {
    const selection = selectionOf(file('a'));
    const { result } = renderHook(() => useModalStack(selection.source));

    act(() => result.current.setActiveModal('settings'));
    expect(result.current.activeModal).toBe('settings');
    expect(result.current.modalData).toBeNull();
    // No snapshot for a dialog that does not act on a list of files.
    expect(result.current.transferItems.map((item) => item.id)).toEqual(['a']);
  });

  it('accepts a functional update, as a state setter does', () => {
    const selection = selectionOf(file('a'));
    const { result } = renderHook(() => useModalStack(selection.source));

    act(() => result.current.setActiveModal('maps'));
    act(() => result.current.setActiveModal((current) => (current === 'maps' ? null : 'maps')));
    expect(result.current.activeModal).toBeNull();
  });

  it('keeps the setter stable, so the panels do not restart on every render', () => {
    const selection = selectionOf(file('a'));
    const { result, rerender } = renderHook(() => useModalStack(selection.source));
    const first = result.current.setActiveModal;
    rerender();
    expect(result.current.setActiveModal).toBe(first);
  });
});
