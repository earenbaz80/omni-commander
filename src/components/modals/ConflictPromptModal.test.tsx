import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConflictPromptModal } from './ConflictPromptModal';
import { themes } from '../../services/themeManager';
import { PendingConflict } from '../../types';

/**
 * The prompt is the only thing standing between a parked transfer and the disk,
 * and "always" is the difference between one answer and an entire batch. These
 * tests pin both: the default must answer once, and the always variant must
 * arrive at the server as `applyToAll`.
 */

const conflict = (overrides: Partial<PendingConflict> = {}): PendingConflict => ({
  jobId: 'job_1',
  source: 'T:\\origen\\informe.txt',
  destination: 'T:\\destino\\informe.txt',
  name: 'informe.txt',
  sourceSize: 12288,
  destinationSize: 2048,
  sourceModified: new Date('2026-10-23T08:00:00Z').getTime(),
  destinationModified: new Date('2026-10-22T08:00:00Z').getTime(),
  ...overrides
});

const renderPrompt = (overrides: Partial<PendingConflict> = {}) => {
  const onAnswer = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConflictPromptModal
      conflict={conflict(overrides)}
      theme={themes.classic_blue}
      lang="en"
      onAnswer={onAnswer}
      onCancel={onCancel}
    />
  );
  return { onAnswer, onCancel };
};

describe('ConflictPromptModal', () => {
  it('answers only this file by default', () => {
    const { onAnswer } = renderPrompt();

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(onAnswer).toHaveBeenCalledWith('skip', false);
  });

  it('carries the always variant to the caller', () => {
    const { onAnswer } = renderPrompt();

    fireEvent.click(screen.getByRole('radio', { name: 'Always…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }));

    expect(onAnswer).toHaveBeenCalledWith('overwrite', true);
  });

  it('shows both sides so the answer is not a guess', () => {
    renderPrompt();

    expect(screen.getByText('T:\\origen\\informe.txt')).toBeTruthy();
    expect(screen.getByText('T:\\destino\\informe.txt')).toBeTruthy();
    expect(screen.getByText('12 KB')).toBeTruthy();
    expect(screen.getByText('2.0 KB')).toBeTruthy();
  });

  it('points out a destination that is already identical', () => {
    const same = new Date('2026-10-23T08:00:00Z').getTime();
    renderPrompt({ sourceSize: 10, destinationSize: 10, sourceModified: same, destinationModified: same, identical: true });

    expect(screen.getByText(/same size and date/i)).toBeTruthy();
  });

  it('cancels the whole transfer instead of leaving it parked', () => {
    const { onAnswer, onCancel } = renderPrompt();

    // The header cross and the footer button share the label; the footer one is
    // the explicit abort path this test is about.
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[1]);

    expect(onCancel).toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
