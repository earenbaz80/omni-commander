import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskQueueBar } from './TaskQueueBar';
import { themes } from '../services/themeManager';
import { taskQueue } from '../services/taskQueueManager';

describe('TaskQueueBar accessibility', () => {
  it('gives the collapse toggle a descriptive name and expanded state', () => {
    // The bar only renders while there is live work, so give it one. The
    // executor never resolves, which keeps the task in the "running" state.
    taskQueue.addTask('copy', 'Retro transfer', 'demo', 1024, () => new Promise<void>(() => {}));
    render(<TaskQueueBar onOpenTasksModal={vi.fn()} lang="es" theme={themes.classic_blue} />);

    const toggle = screen.getByRole('button', { name: 'Contraer cola de tareas' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
